using System.Net;
using System.Net.Sockets;

namespace AllInOneInstaller.Remote;

/// <summary>How fail2ban protects SSH: how many failed logins within how long ban an address, for how long.</summary>
public sealed record Fail2BanSettings(int MaxRetry, int FindTimeMinutes, int BanTimeMinutes, bool Increment, IReadOnlyList<string> Whitelist);

/// <summary>Fail2ban on the server before a step or tool runs.</summary>
public sealed record Fail2BanState(
    bool Installed,
    string? Version,
    bool Running,
    bool Configured,
    Fail2BanSettings? Settings,
    IReadOnlyList<int> SshPorts,
    IReadOnlyList<string> Banned,
    int TotalBanned,
    string? ClientIp)
{
    public bool IsComplete => Installed && Running && Configured;
}

/// <summary>
/// Fail2ban for SSH: bans an address after too many failed logins (in the systemd journal), on every port sshd listens
/// on. The installer's settings live in /etc/fail2ban/jail.d/all-in-1.local, which overrides the distribution's
/// defaults; the whitelist (ignoreip) is never banned.
/// </summary>
public static class Fail2BanInstaller
{
    public const string ConfigFile = "/etc/fail2ban/jail.d/all-in-1.local";
    /// <summary>fail2ban's own log (logtarget in fail2ban.conf on Debian and Ubuntu): Found, Ban and Unban lines.</summary>
    public const string LogFile = "/var/log/fail2ban.log";
    public const string Jail = "sshd";
    public const int MaxWhitelistEntries = 100;

    public static readonly Fail2BanSettings Defaults = new(5, 10, 60, true, []);

    /// <summary>An IPv4 or IPv6 address, or a network such as 192.168.1.0/24: null when valid, else the reason.</summary>
    public static string? EntryProblem(string entry)
    {
        string[] parts = entry.Split('/');
        // IPAddress also takes short forms such as "10.1" (10.0.0.1): fail2ban does not, so IPv4 needs all four parts.
        bool shortIpv4 = !parts[0].Contains(':') && parts[0].Split('.').Length != 4;
        if (parts.Length > 2 || shortIpv4 || !IPAddress.TryParse(parts[0], out IPAddress? address) || parts[0].Contains('%'))
            return $"\"{entry}\" is not an IP address or a network such as 192.168.1.0/24.";
        if (parts.Length == 2)
        {
            int max = address.AddressFamily == AddressFamily.InterNetworkV6 ? 128 : 32;
            if (!int.TryParse(parts[1], out int prefix) || prefix < 0 || prefix > max)
                return $"\"{entry}\": the part after / must be a number from 0 to {max}.";
        }
        return null;
    }

    /// <summary>The whitelist from text: one entry per line (or separated by spaces or commas), without duplicates.</summary>
    public static (List<string> Entries, string? Problem) ParseWhitelist(string text)
    {
        var entries = new List<string>();
        foreach (string line in text.Split(['\n', '\r']))
        {
            // "# ..." is a comment, also after an entry.
            string content = line.Split('#', 2)[0];
            foreach (string entry in content.Split([',', ' ', '\t'], StringSplitOptions.RemoveEmptyEntries))
            {
                if (EntryProblem(entry) is { } problem) return (entries, problem);
                if (!entries.Contains(entry, StringComparer.OrdinalIgnoreCase)) entries.Add(entry);
            }
        }
        return entries.Count > MaxWhitelistEntries
            ? (entries, $"At most {MaxWhitelistEntries} whitelist entries.")
            : (entries, null);
    }

    public static string? SettingsProblem(Fail2BanSettings settings) =>
        settings.MaxRetry is < 1 or > 100 ? "Failed logins before a ban: a number from 1 to 100."
        : settings.FindTimeMinutes is < 1 or > 10080 ? "Counted within: from 1 minute to 7 days (10080 minutes)."
        : settings.BanTimeMinutes is < 1 or > 525600 ? "Ban time: from 1 minute to 365 days (525600 minutes)."
        : null;

    public static async Task<Fail2BanState> InspectAsync(ServerConnection connection, CancellationToken token = default)
    {
        string script = $$"""
            echo "version=$(fail2ban-client --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)"
            echo "installed=$(command -v fail2ban-client >/dev/null 2>&1 && echo yes)"
            echo "running=$(fail2ban-client ping 2>/dev/null | grep -q pong && echo yes)"
            f={{ConfigFile}}
            if [ -f "$f" ]; then
              echo "configured=yes"
              # [DEFAULT] holds the installer's values.
              get() { awk -F'=' -v k="$1" '$1 ~ "^[[:space:]]*"k"[[:space:]]*$" {sub(/^[[:space:]]+/, "", $2); sub(/[[:space:]]+$/, "", $2); print $2; exit}' "$f"; }
              echo "ignoreip=$(get ignoreip)"
              echo "maxretry=$(get maxretry)"
              echo "findtime=$(get findtime)"
              echo "bantime=$(get bantime)"
              echo "increment=$(get bantime.increment)"
            fi
            echo "ssh=$( (ss -Hltnp 2>/dev/null | grep -E '"sshd"|ssh.socket' | awk '{print $4}' | sed 's/.*://'; sshd -T 2>/dev/null | awk '$1=="port" {print $2}') | sort -un | tr '\n' ' ')"
            if fail2ban-client status {{Jail}} >/tmp/.f2b.$$ 2>/dev/null; then
              echo "banned=$(sed -n 's/.*Banned IP list:[[:space:]]*//p' /tmp/.f2b.$$)"
              echo "total=$(sed -n 's/.*Total banned:[[:space:]]*//p' /tmp/.f2b.$$)"
            fi
            rm -f /tmp/.f2b.$$
            """;
        var values = new ScriptValues((await connection.RunAsRootAsync(script, token)).Output);
        // The address this computer reaches the server from: always whitelisted unless removed by hand.
        string? clientIp = null;
        try
        {
            string output = (await connection.RunAsync("echo \"client=${SSH_CLIENT%% *}\"", token)).Output;
            clientIp = new ScriptValues(output)["client"] is { } ip && EntryProblem(ip) is null ? ip : null;
        }
        catch (ServerConnectionException)
        {
            // Not known: the whitelist simply starts without it.
        }

        Fail2BanSettings? settings = null;
        if (values.Yes("configured"))
        {
            List<string> whitelist = (values["ignoreip"] ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Where(entry => entry is not "127.0.0.1/8" and not "::1").ToList();
            settings = new Fail2BanSettings(
                values.Int("maxretry") is > 0 and var retry ? retry : Defaults.MaxRetry,
                Minutes(values["findtime"]) ?? Defaults.FindTimeMinutes,
                Minutes(values["bantime"]) ?? Defaults.BanTimeMinutes,
                values["increment"] != "false",
                whitelist);
        }
        List<int> ports = (values["ssh"] ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(p => int.TryParse(p, out int port) ? port : 0).Where(p => p > 0).ToList();
        List<string> banned = (values["banned"] ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();
        return new Fail2BanState(values.Yes("installed"), values["version"], values.Yes("running"), values.Yes("configured"), settings,
            ports, banned, values.Int("total"), clientIp);
    }

    // "600" (seconds, fail2ban's unit), "10m", "1h", "2d".
    private static int? Minutes(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        value = value.Trim();
        char unit = char.IsLetter(value[^1]) ? char.ToLowerInvariant(value[^1]) : 's';
        if (!int.TryParse(char.IsLetter(value[^1]) ? value[..^1] : value, out int number)) return null;
        return unit switch { 's' => Math.Max(1, number / 60), 'm' => number, 'h' => number * 60, 'd' => number * 1440, 'w' => number * 10080, _ => null };
    }

    private static string Config(Fail2BanSettings settings, IReadOnlyList<int> sshPorts)
    {
        string ignore = string.Join(' ', new[] { "127.0.0.1/8", "::1" }.Concat(settings.Whitelist));
        string ports = string.Join(',', sshPorts.Count > 0 ? sshPorts : [22]);
        return $"""
            # Written by All-in-1 Installer (Addons -> Fail2Ban; the whitelist also in Tools -> Fail2Ban).
            # Changes here are overwritten by the next run of the addon or the whitelist tool.

            [DEFAULT]
            # Never banned: this server itself and the whitelist.
            ignoreip = {ignore}
            # {settings.MaxRetry} failed logins within {settings.FindTimeMinutes} minutes ban an address for {settings.BanTimeMinutes} minutes.
            maxretry = {settings.MaxRetry}
            findtime = {settings.FindTimeMinutes}m
            bantime = {settings.BanTimeMinutes}m
            # Repeat offenders are banned longer each time (up to a week).
            bantime.increment = {(settings.Increment ? "true" : "false")}
            bantime.maxtime = 1w

            [{Jail}]
            enabled = true
            port = {ports}
            # sshd logs to the systemd journal (Ubuntu 24.04+ and Debian 12+ have no auth.log by default).
            backend = systemd
            """;
    }

    /// <summary>The config as a script part: written, checked with fail2ban-client -t (an invalid one is put back), and fail2ban restarted.</summary>
    private static string ApplyScript(Fail2BanSettings settings, IReadOnlyList<int> sshPorts) => $$"""
        f={{ConfigFile}}
        install -d -m 755 /etc/fail2ban/jail.d
        [ -f "$f" ] && cp -p "$f" "$f.bak"
        cat > "$f" <<'CONF'
        {{Config(settings, sshPorts)}}
        CONF
        chmod 644 "$f"
        # Without systemd there is no journal: the log file instead (auth.log, with rsyslog).
        if [ ! -d /run/systemd/system ]; then
          sed -i 's/^backend = systemd$/backend = auto/' "$f"
          touch /var/log/auth.log
        fi
        if ! fail2ban-client -t >/tmp/.f2b-test 2>&1; then
          sed 's/^/  /' /tmp/.f2b-test | tail -20
          if [ -f "$f.bak" ]; then mv -f "$f.bak" "$f"; else rm -f "$f"; fi
          rm -f /tmp/.f2b-test
          fail "fail2ban refuses the configuration (see above); the previous one is kept."
        fi
        rm -f /tmp/.f2b-test "$f.bak"
        echo "> $f"
        echo "  ignoreip: {{string.Join(' ', settings.Whitelist.DefaultIfEmpty("(only this server)"))}}"
        echo "  {{settings.MaxRetry}} failed logins within {{settings.FindTimeMinutes}} min: banned for {{settings.BanTimeMinutes}} min{{(settings.Increment ? ", longer for repeat offenders" : "")}}"
        if [ -d /run/systemd/system ]; then
          systemctl enable fail2ban >/dev/null 2>&1 || true
          systemctl restart fail2ban
        else
          service fail2ban restart >/dev/null 2>&1 || fail2ban-client restart >/dev/null 2>&1 || fail2ban-client start
        fi
        for i in $(seq 1 20); do fail2ban-client ping 2>/dev/null | grep -q pong && break; sleep 1; done
        fail2ban-client ping 2>/dev/null | grep -q pong || fail "fail2ban does not start: see journalctl -u fail2ban."
        fail2ban-client status {{Jail}} | sed 's/^/  /'
        """;

    /// <summary>Installs fail2ban (and the journal reader it needs), writes the settings and starts it at boot.</summary>
    public static Task InstallAsync(ServerConnection connection, Fail2BanSettings settings, IReadOnlyList<int> sshPorts, Action<string> log,
        CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + $$"""
            if ! command -v fail2ban-client >/dev/null 2>&1 || ! python3 -c 'import systemd.journal' >/dev/null 2>&1; then
              echo "> apt-get install fail2ban python3-systemd"
              apt_update >/dev/null
              DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban python3-systemd >/dev/null
            fi
            if [ ! -d /run/systemd/system ] && ! command -v rsyslogd >/dev/null 2>&1; then
              echo "> apt-get install rsyslog (no systemd journal: fail2ban reads /var/log/auth.log)"
              DEBIAN_FRONTEND=noninteractive apt-get install -y rsyslog >/dev/null
            fi
            [ -d /run/systemd/system ] || pgrep -x rsyslogd >/dev/null || service rsyslog start >/dev/null 2>&1 || rsyslogd 2>/dev/null || true
            echo "  $(fail2ban-client --version 2>/dev/null | head -1)"
            {{ApplyScript(settings, sshPorts)}}
            """;
        return RemoteScript.RunAsync(connection, script, log, "Installing fail2ban failed", token);
    }

    /// <summary>Writes new settings (such as the whitelist) and restarts fail2ban; bans of whitelisted addresses are lifted.</summary>
    public static Task SaveAsync(ServerConnection connection, Fail2BanSettings settings, IReadOnlyList<int> sshPorts, Action<string> log,
        CancellationToken token = default)
    {
        string unban = string.Join('\n', settings.Whitelist.Where(e => !e.Contains('/'))
            .Select(ip => $"[ \"$(fail2ban-client set {Jail} unbanip {ServerConnection.ShellQuote(ip)} 2>/dev/null)\" = 1 ] && echo \"  {ip} was banned: unbanned\" || true"));
        string script = RemoteScript.Prelude + $$"""
            command -v fail2ban-client >/dev/null 2>&1 || fail "fail2ban is not installed: install it with Addons -> Fail2Ban first."
            {{ApplyScript(settings, sshPorts)}}
            {{unban}}
            """;
        return RemoteScript.RunAsync(connection, script, log, "Saving the fail2ban settings failed", token);
    }

    /// <summary>Lifts the ban of one address.</summary>
    public static Task UnbanAsync(ServerConnection connection, string ip, Action<string> log, CancellationToken token = default)
    {
        if (ip.Contains('/')) throw new ServerConnectionException("Unban one address, not a network.");
        if (EntryProblem(ip) is { } problem) throw new ServerConnectionException(problem);
        string script = RemoteScript.Prelude + $$"""
            echo "> fail2ban-client set {{Jail}} unbanip {{ip}}"
            out=$(fail2ban-client set {{Jail}} unbanip {{ServerConnection.ShellQuote(ip)}} 2>&1) || fail "{{ip}} could not be unbanned: $out"
            if [ "$out" = 1 ]; then echo "  {{ip}} can log in again"; else echo "  {{ip}} was not banned (any more)"; fi
            """;
        return RemoteScript.RunAsync(connection, script, log, "Unbanning failed", token);
    }

    /// <summary>Stops fail2ban, takes it off at boot, removes the installer's settings and the package.</summary>
    public static Task RemoveAsync(ServerConnection connection, Action<string> log, CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + $$"""
            if [ -d /run/systemd/system ]; then systemctl disable --now fail2ban >/dev/null 2>&1 || true; else fail2ban-client stop >/dev/null 2>&1 || true; fi
            echo "> fail2ban stopped: every ban is lifted"
            rm -f {{ConfigFile}}
            echo "  {{ConfigFile}} deleted"
            DEBIAN_FRONTEND=noninteractive apt-get remove -y fail2ban >/dev/null && echo "  apt-get remove fail2ban"
            true
            """;
        return RemoteScript.RunAsync(connection, script, log, "Removing fail2ban failed", token);
    }
}
