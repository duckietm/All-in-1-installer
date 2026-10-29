using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>Fail2ban for SSH: too many failed logins ban the address; the whitelist is never banned.</summary>
public sealed class Fail2BanStep : InstallStep
{
    private readonly TextBox _maxRetry = new() { Width = 90, MaxLength = 3 };
    private readonly TextBox _findTime = new() { Width = 90, MaxLength = 5 };
    private readonly TextBox _banTime = new() { Width = 90, MaxLength = 6 };
    private readonly CheckBox _increment = new() { Content = "Ban repeat offenders longer each time (up to a week)", IsChecked = true };
    private readonly TextBox _whitelist = new()
    {
        AcceptsReturn = true,
        TextWrapping = TextWrapping.NoWrap,
        Height = 110,
        FontFamily = new FontFamily("Consolas,Menlo,monospace"),
        PlaceholderText = "One address or network per line, for example\n203.0.113.7\n192.168.1.0/24"
    };
    private readonly TextBlock _clientHint = Text("", 12, "Pro.Subtle");
    private bool _filled;

    /// <summary>Set after a run, for the finished page.</summary>
    public Fail2BanSettings? Settings { get; private set; }
    public IReadOnlyList<int> SshPorts { get; private set; } = [];
    public string? ClientIp { get; private set; }

    public override string Title => "Fail2Ban";
    public override string Caption => "SSH brute-force protection";
    public override string InstallLabel => "Install Fail2Ban";
    public override string RerunLabel => "Save and restart";

    public Fail2BanStep() : base(Icons.Shield,
        "Install Fail2Ban",
        "Fail2ban watches the SSH logins and bans an address (in the firewall) after too many failed attempts: password guessing bots are shut out after a few tries.",
        [
            "Installs fail2ban from the distribution (apt) and starts it at boot.",
            "Protects SSH on every port sshd listens on, reading the systemd journal (also on Ubuntu 24.04+ and Debian 12+ without auth.log).",
            "The whitelist is never banned: your own IP address is filled in, so a typo in a password cannot lock you out. Add your office or home network as well.",
            $"The settings are written to {Fail2BanInstaller.ConfigFile}; the distribution's own files stay untouched.",
            "Later: Tools → Fail2Ban to edit the whitelist and to unban an address. Running this step again saves new settings."
        ],
        "Works with or without the Harden step's firewall (ufw).",
        [
            "Check the server",
            "Install fail2ban and protect SSH",
            "Check the SSH jail"
        ])
    {
    }

    protected override Control BuildOptions()
    {
        var panel = new StackPanel { Spacing = 8, Margin = new Thickness(0, 8, 0, 0) };
        var numbers = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 18 };
        numbers.Children.Add(Field("Failed logins before a ban", _maxRetry));
        numbers.Children.Add(Field("Counted within (minutes)", _findTime));
        numbers.Children.Add(Field("Ban time (minutes)", _banTime));
        panel.Children.Add(numbers);
        panel.Children.Add(_increment);
        panel.Children.Add(Text("Whitelist (never banned)", 12, "Pro.Muted", FontWeight.SemiBold));
        panel.Children.Add(_whitelist);
        panel.Children.Add(_clientHint);
        Fill(Fail2BanInstaller.Defaults);
        return panel;
    }

    private static Control Field(string label, Control box)
    {
        var field = new StackPanel { Spacing = 4 };
        field.Children.Add(Text(label, 12, "Pro.Muted", FontWeight.SemiBold));
        field.Children.Add(box);
        return field;
    }

    private void Fill(Fail2BanSettings settings)
    {
        _maxRetry.Text = settings.MaxRetry.ToString();
        _findTime.Text = settings.FindTimeMinutes.ToString();
        _banTime.Text = settings.BanTimeMinutes.ToString();
        _increment.IsChecked = settings.Increment;
        _whitelist.Text = string.Join('\n', settings.Whitelist);
    }

    private (Fail2BanSettings? Settings, string? Problem) Read()
    {
        if (!int.TryParse(_maxRetry.Text?.Trim(), out int retry)) return (null, "Failed logins before a ban: fill in a number.");
        if (!int.TryParse(_findTime.Text?.Trim(), out int find)) return (null, "Counted within: fill in a number of minutes.");
        if (!int.TryParse(_banTime.Text?.Trim(), out int ban)) return (null, "Ban time: fill in a number of minutes.");
        (List<string> whitelist, string? problem) = Fail2BanInstaller.ParseWhitelist(_whitelist.Text ?? "");
        if (problem is not null) return (null, problem);
        var settings = new Fail2BanSettings(retry, find, ban, _increment.IsChecked == true, whitelist);
        return Fail2BanInstaller.SettingsProblem(settings) is { } settingsProblem ? (null, settingsProblem) : (settings, null);
    }

    public override string? Validate() => Read().Problem;

    protected override async Task<bool> DetectCoreAsync(ServerConnection connection)
    {
        Fail2BanState state = await Task.Run(() => Fail2BanInstaller.InspectAsync(connection));
        ClientIp = state.ClientIp;
        SshPorts = state.SshPorts;
        if (!_filled)
        {
            // The settings on the server, or the defaults with this computer's address on the whitelist.
            Fill(state.Settings ?? Fail2BanInstaller.Defaults with { Whitelist = state.ClientIp is { } ip ? [ip] : [] });
            _filled = true;
        }
        _clientHint.Text = state.ClientIp is { } client
            ? $"This computer reaches the server from {client}." +
              (Fail2BanInstaller.ParseWhitelist(_whitelist.Text ?? "").Entries.Contains(client) ? "" : " It is not on the whitelist: add it, unless that address changes often.")
            : "Your own IP address could not be found: add it yourself (search \"what is my IP\").";
        string ports = state.SshPorts.Count > 0 ? string.Join(", ", state.SshPorts) : "22";
        if (state.IsComplete)
        {
            Settings = state.Settings;
            Detected.Show(ResultKind.Success, $"Fail2Ban {state.Version} protects SSH (port {ports})",
                $"{state.Banned.Count} address(es) banned now, {state.TotalBanned} in total since the last restart. You can skip this step, or save new settings.");
            return true;
        }
        Detected.Show(ResultKind.Info, state.Installed ? "Fail2ban is installed, but not set up by the installer" : "Fail2ban will be installed",
            state.Installed
                ? $"Its SSH jail is set up with the settings below (port {ports}); the distribution's other jails stay as they are."
                : $"From apt, protecting SSH on port {ports}.");
        return false;
    }

    protected override async Task<StepOutcome> RunCoreAsync(ServerConnection connection, Window owner)
    {
        Run.Log("> Checking the server ...");
        (Fail2BanSettings? settings, string? problem) = Read();
        if (settings is null) throw new ServerConnectionException(problem!);
        Fail2BanState state = await Task.Run(() => Fail2BanInstaller.InspectAsync(connection));
        SshPorts = state.SshPorts.Count > 0 ? state.SshPorts : [connection.Login.Port];
        ClientIp = state.ClientIp;
        Run.Log($"  SSH on port {string.Join(", ", SshPorts)}; {(state.Installed ? $"fail2ban {state.Version} is installed" : "fail2ban is not installed yet")}");
        if (state.ClientIp is { } client && !settings.Whitelist.Contains(client))
            Run.Log($"  Note: this computer ({client}) is not on the whitelist");
        Run.Done($"port {string.Join(", ", SshPorts)}");

        await Task.Run(() => Fail2BanInstaller.InstallAsync(connection, settings, SshPorts, Run.Log));
        Run.Done("running");

        Fail2BanState after = await Task.Run(() => Fail2BanInstaller.InspectAsync(connection));
        if (!after.IsComplete) throw new ServerConnectionException("Fail2ban does not run with the SSH jail: see journalctl -u fail2ban.");
        Run.Done($"{after.Banned.Count} banned");

        Settings = settings;
        return await SucceededAsync($"Fail2Ban protects SSH (port {string.Join(", ", SshPorts)})",
            $"{settings.MaxRetry} failed logins within {settings.FindTimeMinutes} minutes ban an address for {settings.BanTimeMinutes} minutes. " +
            $"{settings.Whitelist.Count} whitelist entr{(settings.Whitelist.Count == 1 ? "y" : "ies")}; edit them later in Tools → Fail2Ban.");
    }
}
