using System.Text.RegularExpressions;

namespace AllInOneInstaller.Configuration;

/// <summary>Whether AtomCMS is on the server: found by looking, or set by hand in Settings.</summary>
public enum AtomCmsPresence { Detect, Installed, NotInstalled }

/// <summary>
/// Where the hotel lives on the server and the account the emulator runs as (Settings → Server layout). Read once at
/// startup, like the look, so every step of a run uses the same places. The values go into shell scripts that run as
/// root, so <see cref="Validate"/> only lets plain paths and names through.
/// </summary>
public sealed partial class ServerLayout
{
    public string EmulatorRepository { get; set; } = "/var/www/emulator";
    public string EmulatorAccount { get; set; } = "emulator";
    public string EmulatorLogs { get; set; } = "/var/log/emu";
    public string Octane { get; set; } = "/var/www/Octane";
    public string Renderer { get; set; } = "/var/www/Octane-Renderer";
    public string Gamedata { get; set; } = "/var/www/gamedata";
    public string AtomCms { get; set; } = "/var/www/atomcms";
    [System.Text.Json.Serialization.JsonConverter(typeof(System.Text.Json.Serialization.JsonStringEnumConverter<AtomCmsPresence>))]
    public AtomCmsPresence AtomCmsInstalled { get; set; } = AtomCmsPresence.Detect;
    public string Backups { get; set; } = "/var/backups/all-in-1";
    public string Database { get; set; } = "habbo";

    public const string RootAccount = "root";

    /// <summary>A Linux user name: lower case letters, digits, '_' and '-', starting with a letter or '_'.</summary>
    public static bool IsValidAccount(string name) => AccountPattern().IsMatch(name);

    /// <summary>The layout this run of the installer uses.</summary>
    public static ServerLayout Current { get; } = InstallerSettings.Load().Layout ?? new ServerLayout();

    /// <summary>Home folder of the emulator's account (Maven's ~/.m2 lives there).</summary>
    public string EmulatorHome => EmulatorAccount == RootAccount ? "/root" : $"/var/lib/{EmulatorAccount}";

    public ServerLayout Copy() => (ServerLayout)MemberwiseClone();

    /// <summary>The paths with their names, for checks and messages.</summary>
    public (string Name, string Value)[] Paths =>
    [
        ("Emulator", EmulatorRepository), ("Emulator logs", EmulatorLogs), ("Octane", Octane), ("Octane-Renderer", Renderer),
        ("Gamedata", Gamedata), ("AtomCMS", AtomCms), ("Database backups", Backups)
    ];

    /// <summary>Null when every value is usable, else what is wrong.</summary>
    public string? Validate()
    {
        foreach ((string name, string value) in Paths)
        {
            if (!PathPattern().IsMatch(value) || value.Split('/').Any(part => part is "." or ".."))
                return $"{name}: \"{value}\" is not a usable path. Use an absolute path such as /var/www/hotel, with letters, digits, '.', '_', '-' and '/'.";
            if (value.TrimEnd('/').Length < 2 || value.TrimEnd('/') is "/var" or "/var/www" or "/usr" or "/etc" or "/opt" or "/home" or "/root" or "/tmp")
                return $"{name}: \"{value}\" is a system folder; use a folder of its own inside it.";
        }
        var distinct = Paths.Select(p => p.Value.TrimEnd('/')).ToList();
        if (distinct.Distinct().Count() != distinct.Count) return "Two of the paths are the same folder: every part needs a folder of its own.";
        if (!AccountPattern().IsMatch(EmulatorAccount))
            return "Emulator account: use a Linux user name (lower case letters, digits, '_' and '-', starting with a letter or '_').";
        if (!DatabasePattern().IsMatch(Database)) return "Database: use letters, digits and '_' only.";
        return null;
    }

    /// <summary>Removes trailing slashes and spaces around the values.</summary>
    public void Normalize()
    {
        static string Clean(string path) => path.Trim() is { Length: > 1 } p ? p.TrimEnd('/') : path.Trim();
        EmulatorRepository = Clean(EmulatorRepository);
        EmulatorLogs = Clean(EmulatorLogs);
        Octane = Clean(Octane);
        Renderer = Clean(Renderer);
        Gamedata = Clean(Gamedata);
        AtomCms = Clean(AtomCms);
        Backups = Clean(Backups);
        EmulatorAccount = EmulatorAccount.Trim();
        Database = Database.Trim();
    }

    [GeneratedRegex("^/[A-Za-z0-9._/-]+$")]
    private static partial Regex PathPattern();

    [GeneratedRegex("^[a-z_][a-z0-9_-]{0,31}$")]
    private static partial Regex AccountPattern();

    [GeneratedRegex("^[A-Za-z0-9_]{1,64}$")]
    private static partial Regex DatabasePattern();
}
