using AllInOneInstaller.Configuration;

namespace AllInOneInstaller.Remote;

/// <summary>An account on the server, from /etc/passwd.</summary>
public sealed record ServerUser(string Name, int Uid, string Home, string Shell, bool InWwwData)
{
    /// <summary>A service account (below uid 1000), such as the one the Emulator step creates.</summary>
    public bool IsSystem => Uid is > 0 and < 1000;
    public bool CanLogIn => !Shell.EndsWith("nologin", StringComparison.Ordinal) && !Shell.EndsWith("/false", StringComparison.Ordinal);
}

/// <summary>The accounts the emulator can run as (Settings → Server layout), and creating a new one.</summary>
public static class ServerUsers
{
    /// <summary>
    /// root, the people's accounts (uid 1000 and up that can log in) and the accounts in group www-data, which is where
    /// the emulator's account lives. Other service accounts (daemon, mysql, build accounts without a login ...) are left out.
    /// </summary>
    public static async Task<List<ServerUser>> ListAsync(ServerConnection connection, CancellationToken token = default)
    {
        const string script = """
            echo "www=$(getent group www-data | cut -d: -f4)"
            getent passwd | awk -F: '{ print "user=" $1 ":" $3 ":" $6 ":" $7 }'
            """;
        CommandResult result = await connection.RunAsRootAsync(script, token);
        if (!result.Succeeded) throw new ServerConnectionException("Could not read the users of the server: " + result.Error.Trim());
        string[] lines = result.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var www = (lines.FirstOrDefault(l => l.StartsWith("www=", StringComparison.Ordinal))?[4..] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        var users = new List<ServerUser>();
        foreach (string line in lines.Where(l => l.StartsWith("user=", StringComparison.Ordinal)))
        {
            string[] parts = line[5..].Split(':');
            if (parts.Length < 4 || !int.TryParse(parts[1], out int uid)) continue;
            var user = new ServerUser(parts[0], uid, parts[2], parts[3], www.Contains(parts[0]));
            if (user.Uid == 0 || (user.Uid is >= 1000 and < 65534 && user.CanLogIn) || (user.InWwwData && user.Name != "www-data")) users.Add(user);
        }
        // root first, then the others by name.
        return users.OrderBy(u => u.Uid == 0 ? 0 : 1).ThenBy(u => u.Name, StringComparer.Ordinal).ToList();
    }

    /// <summary>
    /// Creates a service account like the Emulator step does: no login shell, home in /var/lib/&lt;name&gt; (for the build's
    /// ~/.m2) and member of www-data. An account that already exists is only added to www-data.
    /// </summary>
    public static async Task CreateAsync(ServerConnection connection, string name, CancellationToken token = default)
    {
        if (!ServerLayout.IsValidAccount(name) || name == ServerLayout.RootAccount)
            throw new ServerConnectionException($"\"{name}\" is not a usable account name.");
        string script = $$"""
            set -e
            if ! id {{name}} >/dev/null 2>&1; then
              useradd --system --user-group --home-dir /var/lib/{{name}} --create-home --shell /usr/sbin/nologin {{name}}
            fi
            getent group www-data >/dev/null || groupadd --system www-data
            usermod -aG www-data {{name}}
            id {{name}}
            """;
        CommandResult result = await connection.RunAsRootAsync(script, token);
        if (!result.Succeeded) throw new ServerConnectionException($"Creating the account {name} failed: " + (result.Error.Trim() is { Length: > 0 } e ? e : result.Output.Trim()));
    }
}
