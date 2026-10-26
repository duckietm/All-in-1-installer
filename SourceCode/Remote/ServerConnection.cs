using Renci.SshNet;
using Renci.SshNet.Common;

namespace AllInOneInstaller.Remote;

/// <summary>A password login, or a key login when <paramref name="PrivateKeys"/> is set. The addons log in as root with the saved keys.</summary>
public sealed record ServerLogin(string Host, int Port, string User, string Password, IReadOnlyList<string>? PrivateKeys = null,
    string KeyPassphrase = "")
{
    public bool UsesKey => PrivateKeys is { Count: > 0 };

    /// <summary>Parses "host", "host:port" or "[ipv6]:port". The port defaults to 22.</summary>
    public static (string Host, int Port) ParseHost(string text)
    {
        text = text.Trim();
        if (text.StartsWith('[') && text.IndexOf(']') is var close and > 0)
        {
            string host = text[1..close];
            string rest = text[(close + 1)..];
            return rest.StartsWith(':') && int.TryParse(rest[1..], out int p) ? (host, p) : (host, 22);
        }
        // A single colon is host:port; more colons is a bare IPv6 address.
        int colon = text.LastIndexOf(':');
        if (colon > 0 && text.IndexOf(':') == colon && int.TryParse(text[(colon + 1)..], out int port))
            return (text[..colon], port);
        return (text, 22);
    }
}

/// <summary>From /etc/os-release.</summary>
public sealed record OsInfo(string Id, string VersionId, string PrettyName)
{
    public bool IsSupported => Id is "ubuntu" or "debian";
}

/// <summary>The stages of <see cref="ServerConnection.ConnectAsync"/>, in order.</summary>
public enum ConnectStage { Login, OperatingSystem, Root }

public sealed record CommandResult(int ExitCode, string Output, string Error)
{
    public bool Succeeded => ExitCode == 0;
}

public sealed class ServerConnectionException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>SSH session to the target server. Root commands go through sudo when the login user is not root.</summary>
public sealed class ServerConnection : IAsyncDisposable
{
    private enum Elevation { None, Root, SudoNoPassword, SudoPassword }

    private readonly ServerLogin _login;
    private readonly Action<string> _log;
    private readonly Action<ConnectStage> _stage;
    private readonly SshClient _client;
    private readonly ConnectionInfo _info;
    private Elevation _elevation = Elevation.None;

    public string LoginUser { get; private set; } = "";
    public string HostKeyFingerprint { get; private set; } = "";
    public OsInfo? Os { get; private set; }
    public bool IsRoot => _elevation != Elevation.None;
    public bool IsConnected => _client.IsConnected;
    public ServerLogin Login => _login;

    private ServerConnection(ServerLogin login, Action<string> log, Action<ConnectStage> stage)
    {
        _login = login;
        _log = log;
        _stage = stage;

        var info = new ConnectionInfo(login.Host, login.Port, login.User, AuthenticationMethods(login))
        {
            Timeout = TimeSpan.FromSeconds(20)
        };
        _info = info;
        // Installs run for minutes, and keep-alives stop routers and firewalls from dropping an idle-looking session.
        _client = new SshClient(info) { KeepAliveInterval = TimeSpan.FromSeconds(30) };
        _client.HostKeyReceived += (_, e) =>
        {
            HostKeyFingerprint = $"{e.HostKeyName} SHA256:{e.FingerPrintSHA256}";
            e.CanTrust = true;
        };
    }

    private static AuthenticationMethod[] AuthenticationMethods(ServerLogin login)
    {
        if (login.UsesKey)
        {
            var files = new List<IPrivateKeySource>();
            string? problem = null;
            foreach (string path in login.PrivateKeys!)
            {
                try
                {
                    files.Add(new PrivateKeyFile(path, login.KeyPassphrase.Length > 0 ? login.KeyPassphrase : null));
                }
                catch (SshPassPhraseNullOrEmptyException)
                {
                    problem = $"The SSH key {Path.GetFileName(path)} has a password: enter it as the key password.";
                }
                catch (Exception ex) when (ex is SshException or IOException or InvalidOperationException or ArgumentException)
                {
                    problem = login.KeyPassphrase.Length > 0
                        ? $"The SSH key {Path.GetFileName(path)} could not be opened: wrong key password?"
                        : $"The SSH key {Path.GetFileName(path)} could not be opened: {ex.Message}";
                }
            }
            if (files.Count == 0) throw new ServerConnectionException(problem ?? "No SSH key to log in with.");
            return [new PrivateKeyAuthenticationMethod(login.User, files.ToArray())];
        }

        var keyboard = new KeyboardInteractiveAuthenticationMethod(login.User);
        // Ubuntu and Debian often only offer keyboard-interactive (PAM) for password logins.
        keyboard.AuthenticationPrompt += (_, e) =>
        {
            foreach (AuthenticationPrompt prompt in e.Prompts) prompt.Response = login.Password;
        };
        return [new PasswordAuthenticationMethod(login.User, login.Password), keyboard];
    }

    /// <summary>Logs in, checks the distribution and verifies root access.</summary>
    public static async Task<ServerConnection> ConnectAsync(ServerLogin login, Action<string> log, Action<ConnectStage> stage,
        CancellationToken token = default)
    {
        var connection = new ServerConnection(login, log, stage);
        try
        {
            await connection.OpenAsync(token);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    private async Task OpenAsync(CancellationToken token)
    {
        _stage(ConnectStage.Login);
        _log($"> Connecting to {_login.Host}:{_login.Port} as {_login.User}" +
             (_login.UsesKey ? $" with the SSH key {string.Join(", ", _login.PrivateKeys!.Select(Path.GetFileName))} ..." : " ..."));
        try
        {
            await _client.ConnectAsync(token);
        }
        catch (SshAuthenticationException ex)
        {
            throw new ServerConnectionException(_login.UsesKey
                ? $"The server refused the SSH key for '{_login.User}'. Is it still in /root/.ssh/authorized_keys, and does sshd allow root logins with a key (PermitRootLogin prohibit-password)?"
                : $"Login refused for user '{_login.User}': wrong user name or password.", ex);
        }
        catch (Exception ex) when (ex is SshException or System.Net.Sockets.SocketException or TimeoutException or SshOperationTimeoutException)
        {
            throw new ServerConnectionException($"Could not reach {_login.Host}:{_login.Port}: {ex.Message}", ex);
        }
        _log($"  Connected. Host key {HostKeyFingerprint}");

        LoginUser = (await RunAsync("id -un", token)).Output.Trim();
        string uid = (await RunAsync("id -u", token)).Output.Trim();
        _log($"  Logged in as '{LoginUser}' (uid {uid}).");

        _stage(ConnectStage.OperatingSystem);
        Os = ParseOsRelease((await RunAsync("cat /etc/os-release", token)).Output);
        _log($"  Operating system: {Os.PrettyName}");
        if (!Os.IsSupported)
            throw new ServerConnectionException($"'{Os.PrettyName}' is not supported. This installer only supports Ubuntu Server and Debian.");

        _stage(ConnectStage.Root);
        if (uid == "0")
        {
            _elevation = Elevation.Root;
            _log("  Already root, no sudo needed.");
        }
        else
        {
            await ElevateAsync(token);
        }

        CommandResult check = await RunAsRootAsync("id -un", token);
        if (!check.Succeeded || check.Output.Trim() != "root")
            throw new ServerConnectionException("Switching to root did not work: " + FirstLine(check.Error, check.Output));
        _log("  Root access confirmed.");
    }

    private async Task ElevateAsync(CancellationToken token)
    {
        _log($"> '{LoginUser}' is not root, switching to root with sudo ...");
        if (!(await RunAsync("command -v sudo", token)).Succeeded)
            throw new ServerConnectionException("sudo is not installed on the server. Log in as root, or install sudo and add the user to the 'sudo' group.");

        if ((await RunAsync("sudo -n true", token)).Succeeded)
        {
            _elevation = Elevation.SudoNoPassword;
            _log("  sudo works without a password.");
            return;
        }

        if (_login.UsesKey)
            throw new ServerConnectionException(
                $"'{LoginUser}' logged in with the SSH key, but sudo asks for a password. Log in as root with the key, allow sudo without a password for '{LoginUser}', or log in with the password instead.");
        CommandResult result = await RunAsync("sudo -S -p '' -k id -u", token, _login.Password + "\n");
        if (!result.Succeeded || result.Output.Trim() != "0")
        {
            string reason = FirstLine(result.Error, result.Output);
            throw new ServerConnectionException(
                $"sudo refused '{LoginUser}'" + (reason.Length > 0 ? $": {reason}" : ".") +
                " Make sure the user is in the 'sudo' group (usermod -aG sudo " + LoginUser + ").");
        }
        _elevation = Elevation.SudoPassword;
        _log("  sudo accepted the password.");
    }

    // SFTP runs as the login user. Without a root login, files in root-only folders (the database backups) go through
    // a staging folder that only the login user can open.
    private bool SftpIsRoot => LoginUser == "root";

    private async Task<string> CreateStagingFolderAsync(CancellationToken token)
    {
        CommandResult result = await RunAsRootAsync(
            $"d=$(mktemp -d /tmp/all-in-1.XXXXXX) && chown {ShellQuote(LoginUser)} \"$d\" && chmod 700 \"$d\" && echo \"$d\"", token);
        if (!result.Succeeded) throw new ServerConnectionException("Could not create a staging folder on the server: " + FirstLine(result.Error, result.Output));
        return result.Output.Trim();
    }

    private async Task RemoveStagingFolderAsync(string folder)
    {
        try { await RunAsRootAsync($"rm -rf -- {ShellQuote(folder)}"); } catch (Exception) { }
    }

    /// <summary>
    /// Copies a file from the server over SFTP. A file only root can read is copied to a staging folder first when
    /// the login user is not root. <paramref name="progress"/> gets the bytes copied so far.
    /// </summary>
    public async Task DownloadAsync(string remotePath, string localPath, Action<ulong>? progress = null, CancellationToken token = default)
    {
        string source = remotePath;
        string? staging = null;
        try
        {
            if (!SftpIsRoot)
            {
                staging = await CreateStagingFolderAsync(token);
                source = $"{staging}/{Path.GetFileName(remotePath)}";
                CommandResult copy = await RunAsRootAsync($"cp -- {ShellQuote(remotePath)} {ShellQuote(source)} && chown {ShellQuote(LoginUser)} {ShellQuote(source)}", token);
                if (!copy.Succeeded) throw new ServerConnectionException($"Could not read {remotePath}: {FirstLine(copy.Error, copy.Output)}");
            }
            await Task.Run(() =>
            {
                using SftpClient sftp = OpenSftp();
                using FileStream file = File.Create(localPath);
                sftp.DownloadFile(source, file, bytes => progress?.Invoke(bytes));
            }, token);
        }
        finally
        {
            if (staging is not null) await RemoveStagingFolderAsync(staging);
        }
    }

    /// <summary>
    /// Downloads several files over one SFTP session and creates the local folders as needed.
    /// <paramref name="progress"/> gets the bytes of all files copied so far.
    /// </summary>
    public Task DownloadFilesAsync(IReadOnlyList<(string Remote, string Local)> files, Action<long>? progress = null, CancellationToken token = default) =>
        Task.Run(() =>
        {
            using SftpClient sftp = OpenSftp();
            long done = 0;
            foreach ((string remote, string local) in files)
            {
                token.ThrowIfCancellationRequested();
                Directory.CreateDirectory(Path.GetDirectoryName(local)!);
                long before = done;
                using (FileStream file = File.Create(local))
                    sftp.DownloadFile(remote, file, bytes => progress?.Invoke(before + (long)bytes));
                done = before + new FileInfo(local).Length;
                progress?.Invoke(done);
            }
        }, token);

    /// <summary>Reads a small file into memory, or returns null when it is larger than <paramref name="maxBytes"/>.</summary>
    public Task<byte[]?> ReadFileAsync(string remotePath, long maxBytes, CancellationToken token = default) =>
        Task.Run(() =>
        {
            using SftpClient sftp = OpenSftp();
            if (sftp.GetAttributes(remotePath).Size > maxBytes) return null;
            using var memory = new MemoryStream();
            sftp.DownloadFile(remotePath, memory);
            return (byte[]?)memory.ToArray();
        }, token);

    /// <summary>
    /// Copies a file to the server over SFTP. Without a root login it goes to a staging folder first and root moves it
    /// into place (owned by root).
    /// </summary>
    public async Task UploadAsync(string localPath, string remotePath, Action<ulong>? progress = null, CancellationToken token = default)
    {
        string target = remotePath;
        string? staging = null;
        try
        {
            if (!SftpIsRoot)
            {
                staging = await CreateStagingFolderAsync(token);
                target = $"{staging}/{Path.GetFileName(remotePath)}";
            }
            await Task.Run(() =>
            {
                using SftpClient sftp = OpenSftp();
                using FileStream file = File.OpenRead(localPath);
                sftp.UploadFile(file, target, bytes => progress?.Invoke(bytes));
            }, token);
            if (staging is not null)
            {
                CommandResult move = await RunAsRootAsync($"mv -f -- {ShellQuote(target)} {ShellQuote(remotePath)} && chown root:root {ShellQuote(remotePath)}", token);
                if (!move.Succeeded) throw new ServerConnectionException($"Could not write {remotePath}: {FirstLine(move.Error, move.Output)}");
            }
        }
        finally
        {
            if (staging is not null) await RemoveStagingFolderAsync(staging);
        }
    }

    /// <summary>An interactive xterm-256color shell of this size as the logged-in user.</summary>
    public ShellStream OpenShell(int columns, int rows) =>
        _client.CreateShellStream("xterm-256color", (uint)columns, (uint)rows, 0, 0, 1 << 16);

    private SftpClient OpenSftp()
    {
        var sftp = new SftpClient(_info);
        // Only the server this session already trusts.
        sftp.HostKeyReceived += (_, e) => e.CanTrust = $"{e.HostKeyName} SHA256:{e.FingerPrintSHA256}" == HostKeyFingerprint;
        sftp.Connect();
        return sftp;
    }

    /// <summary>
    /// Like ssh -L: a free port on 127.0.0.1 of this computer that leads to <paramref name="host"/>:<paramref name="port"/>
    /// as the server sees it. Dispose closes it.
    /// </summary>
    public PortForward ForwardLocalPort(string host, int port)
    {
        var forward = new ForwardedPortLocal("127.0.0.1", 0, host, (uint)port);
        _client.AddForwardedPort(forward);
        try
        {
            forward.Start();
        }
        catch
        {
            _client.RemoveForwardedPort(forward);
            forward.Dispose();
            throw;
        }
        return new PortForward(_client, forward);
    }

    public sealed class PortForward(SshClient client, ForwardedPortLocal forward) : IDisposable
    {
        public int LocalPort => (int)forward.BoundPort;

        public void Dispose()
        {
            try { forward.Stop(); } catch { }
            try { client.RemoveForwardedPort(forward); } catch { }
            forward.Dispose();
        }
    }

    public async Task<CommandResult> RunAsync(string command, CancellationToken token = default, string? input = null)
    {
        // A Windows line ending would end up in the command ("set -e\r").
        command = command.ReplaceLineEndings("\n");
        using SshCommand ssh = _client.CreateCommand(command);
        Task execution = ssh.ExecuteAsync(token);
        if (input is not null)
        {
            await using Stream stdin = ssh.CreateInputStream();
            byte[] bytes = System.Text.Encoding.UTF8.GetBytes(input);
            await stdin.WriteAsync(bytes, token);
        }
        await execution;
        return new CommandResult(ssh.ExitStatus ?? -1, ssh.Result, ssh.Error);
    }

    public Task<CommandResult> RunAsRootAsync(string command, CancellationToken token = default)
    {
        (string commandLine, string? input) = RootCommandLine(command);
        return RunAsync(commandLine, token, input);
    }

    /// <summary>
    /// Streams stdout and stderr lines to <paramref name="onLine"/> and returns the exit code. Pass secrets in
    /// <paramref name="stdin"/>, never on the command line, where 'ps' shows them.
    /// </summary>
    public async Task<int> RunAsRootStreamingAsync(string script, Action<string> onLine, CancellationToken token = default,
        string? stdin = null)
    {
        (string commandLine, string? input) = RootCommandLine("exec 2>&1\n" + script);
        // sudo -S reads only the password line, so everything after it reaches the script.
        if (stdin is not null) input = (input ?? "") + stdin;
        using SshCommand ssh = _client.CreateCommand(commandLine.ReplaceLineEndings("\n"));
        Task execution = ssh.ExecuteAsync(token);
        if (input is not null)
        {
            await using Stream inputStream = ssh.CreateInputStream();
            await inputStream.WriteAsync(System.Text.Encoding.UTF8.GetBytes(input), token);
        }
        Task reading = Task.Run(async () =>
        {
            using var reader = new StreamReader(ssh.OutputStream, System.Text.Encoding.UTF8);
            while (await reader.ReadLineAsync(token) is { } line) onLine(line.TrimEnd('\r'));
        }, token);
        await execution;
        await reading;
        // Only sudo itself can still write to stderr, since the script's stderr is redirected.
        foreach (string line in ssh.Error.Split('\n', StringSplitOptions.RemoveEmptyEntries)) onLine(line.TrimEnd('\r'));
        return ssh.ExitStatus ?? -1;
    }

    /// <summary>
    /// Runs a command that never ends by itself (tail -F, docker logs -f) as root and streams its lines until
    /// <paramref name="token"/> is cancelled or the connection drops. The script gets $ALL_IN_1_WATCH, a process that
    /// ends when the SSH channel closes: <see cref="FollowScript"/> waits for it and then stops the command, so nothing
    /// keeps running on the server after the log is left.
    /// </summary>
    public async Task FollowAsRootAsync(string script, Action<string> onLine, CancellationToken token)
    {
        // A background job's stdin is /dev/null unless it is redirected, hence <&0. sudo -S only reads the password line.
        (string commandLine, string? password) = RootCommandLine("exec 2>&1\ncat >/dev/null <&0 &\nALL_IN_1_WATCH=$!\n" + script);
        using SshCommand ssh = _client.CreateCommand(commandLine.ReplaceLineEndings("\n"));
        Task execution = ssh.ExecuteAsync(token);
        // Stdin stays open while following: closing it would end the watcher, and with it the command.
        Stream input = ssh.CreateInputStream();
        try
        {
            if (password is not null)
            {
                await input.WriteAsync(System.Text.Encoding.UTF8.GetBytes(password), token);
                await input.FlushAsync(token);
            }
            Task reading = Task.Run(async () =>
            {
                using var reader = new StreamReader(ssh.OutputStream, System.Text.Encoding.UTF8);
                while (await reader.ReadLineAsync(token) is { } line) onLine(line.TrimEnd('\r'));
            }, token);
            await execution;
            await reading;
        }
        finally
        {
            try { input.Dispose(); } catch (Exception) { }
        }
    }

    /// <summary>
    /// Runs <paramref name="command"/> in a process group of its own until the log is left, then stops the whole group,
    /// so a pipeline or an if/else with tail in it stops too.
    /// </summary>
    public static string FollowScript(string command) => $"""
        setsid bash -c {ShellQuote(command)} &
        follower=$!
        wait $ALL_IN_1_WATCH
        kill -- -$follower 2>/dev/null
        true
        """;

    /// <summary>
    /// Runs <paramref name="script"/> as root with stdin written by <paramref name="writeInput"/>, such as a tar archive
    /// for tar -x. Stdin closes when <paramref name="writeInput"/> returns.
    /// </summary>
    public async Task<CommandResult> RunAsRootWithInputAsync(string script, Func<Stream, CancellationToken, Task> writeInput,
        CancellationToken token = default)
    {
        (string commandLine, string? password) = RootCommandLine("exec 2>&1\n" + script);
        using SshCommand ssh = _client.CreateCommand(commandLine.ReplaceLineEndings("\n"));
        Task execution = ssh.ExecuteAsync(token);
        Task<string> reading = Task.Run(async () =>
        {
            using var reader = new StreamReader(ssh.OutputStream, System.Text.Encoding.UTF8);
            return await reader.ReadToEndAsync(token);
        }, token);
        await using (Stream input = ssh.CreateInputStream())
        {
            // sudo -S reads only the password line, so the rest reaches the script.
            if (password is not null) await input.WriteAsync(System.Text.Encoding.UTF8.GetBytes(password), token);
            await writeInput(input, token);
        }
        await execution;
        string output = await reading;
        return new CommandResult(ssh.ExitStatus ?? -1, output, ssh.Error);
    }

    private (string CommandLine, string? Input) RootCommandLine(string command)
    {
        string quoted = ShellQuote(command);
        return _elevation switch
        {
            Elevation.Root => ($"bash -c {quoted}", null),
            Elevation.SudoNoPassword => ($"sudo -n -H -- bash -c {quoted}", null),
            // Password over stdin, so 'ps' never shows it.
            Elevation.SudoPassword => ($"sudo -S -p '' -H -- bash -c {quoted}", _login.Password + "\n"),
            _ => throw new InvalidOperationException("The connection has no root access yet.")
        };
    }

    public static string ShellQuote(string value) => "'" + value.Replace("'", "'\\''") + "'";

    private static OsInfo ParseOsRelease(string text)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (string line in text.Split('\n'))
        {
            int equals = line.IndexOf('=');
            if (equals <= 0) continue;
            values[line[..equals].Trim()] = line[(equals + 1)..].Trim().Trim('"');
        }
        string id = values.GetValueOrDefault("ID", "unknown").ToLowerInvariant();
        return new OsInfo(id, values.GetValueOrDefault("VERSION_ID", ""), values.GetValueOrDefault("PRETTY_NAME", id));
    }

    private static string FirstLine(params string[] texts) =>
        texts.SelectMany(t => t.Split('\n')).Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0) ?? "";

    public ValueTask DisposeAsync()
    {
        try { if (_client.IsConnected) _client.Disconnect(); } catch { }
        _client.Dispose();
        return ValueTask.CompletedTask;
    }
}
