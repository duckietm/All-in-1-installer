using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>CrowdSec in Docker with Traefik's bouncer, enrolled in the CrowdSec console with the user's key.</summary>
public sealed class CrowdSecStep : InstallStep
{
    private readonly ResultBanner _cloudflare = new();
    private readonly TextBox _key = new() { MinWidth = 520, PlaceholderText = "cm1abc...   or the whole command: sudo cscli console enroll -e context cm1abc..." };
    private readonly TextBlock _keyCheck = Text("", 12, "Pro.Subtle");
    private readonly TextBox _name = new() { Width = 320, MaxLength = 64, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly TextBox _whitelist = new()
    {
        AcceptsReturn = true,
        TextWrapping = TextWrapping.NoWrap,
        Height = 90,
        FontFamily = new FontFamily("Consolas,Menlo,monospace"),
        PlaceholderText = "One address or network per line, for example\n203.0.113.7\n192.168.0.0/24"
    };
    private readonly TextBlock _clientHint = Text("", 12, "Pro.Subtle");
    private bool _enrolled;
    private bool _filled;

    /// <summary>Set after a run, for the finished page.</summary>
    public WebAccessSettings? Site { get; private set; }
    public string? InstanceName { get; private set; }
    public bool EnrolledNow { get; private set; }
    public CrowdSecResult? Result { get; private set; }

    public override string Title => "CrowdSec";
    public override string Caption => "Blocks attackers in Traefik";
    public override string InstallLabel => "Install CrowdSec";
    public override string RerunLabel => "Update CrowdSec";

    public CrowdSecStep() : base(Icons.Shield,
        "Install CrowdSec",
        "CrowdSec (crowdsec.net) watches every request to your hotel through Traefik and blocks addresses that attack it: vulnerability scans, probing, known exploits, brute force. " +
        "Attacks seen by all CrowdSec users are shared, so addresses that attacked others are blocked before they reach you.",
        [
            $"Runs the CrowdSec security engine in Docker ({CrowdSecInstaller.Directory}, image {CrowdSecInstaller.Image}). It reads Traefik's access log; its API is only on 127.0.0.1.",
            "Adds CrowdSec's bouncer plugin to Traefik, on every route (the hotel, the CMS, Polaris, Gitea): a banned address gets 403 Forbidden.",
            "Behind Cloudflare it uses the visitor's real address (past Cloudflare's IP ranges), never Cloudflare's: the step checks how your domain is set up.",
            "The hotel's own files (gamedata, the client) are never counted, so loading a room cannot look like an attack. If CrowdSec stops, the hotel stays reachable.",
            "Required: a free CrowdSec account and its enrollment key (see 1 and 2 below). The engine then shows in your CrowdSec console, with its alerts.",
            "Traefik restarts once (players are disconnected for a moment). If the hotel does not answer as before, the previous Traefik configuration comes back by itself."
        ],
        "Run the Web access step first (Docker and Traefik).",
        [
            "Check the server and Cloudflare",
            "CrowdSec in Docker",
            "Connect to the CrowdSec console",
            "Bouncer in Traefik",
            "Test"
        ])
    {
    }

    protected override Control BuildOptions()
    {
        var panel = new StackPanel { Spacing = 8, Margin = new Thickness(0, 8, 0, 0) };
        panel.Children.Add(_cloudflare);

        panel.Children.Add(Text("1. Make a free CrowdSec account", 13, weight: FontWeight.SemiBold));
        panel.Children.Add(Text("Sign up on the CrowdSec console (free: the Community plan is enough). Already have an account? Just log in.", 12.5));
        var open = new Button { Content = "Open app.crowdsec.net", Padding = new Thickness(14, 6), Classes = { "secondary" }, HorizontalAlignment = HorizontalAlignment.Left };
        open.Click += async (_, _) =>
        {
            if (TopLevel.GetTopLevel(View) is { } top) await top.Launcher.LaunchUriAsync(new Uri(CrowdSecInstaller.ConsoleUrl));
        };
        panel.Children.Add(open);

        panel.Children.Add(Text("2. Copy your enrollment key", 13, weight: FontWeight.SemiBold));
        panel.Children.Add(Text("In the console: Security Engines → Engines → Add Security Engine (on a new account the welcome page shows it right away). " +
            "It shows a command like: sudo cscli console enroll -e context cm1abc...  Copy it and paste it below: the whole command is fine, the installer takes the key out.", 12.5));
        panel.Children.Add(_key);
        panel.Children.Add(_keyCheck);

        panel.Children.Add(Text("3. Name of this server in the console", 13, weight: FontWeight.SemiBold));
        panel.Children.Add(_name);

        panel.Children.Add(Text("Whitelist (never banned)", 13, weight: FontWeight.SemiBold));
        panel.Children.Add(_whitelist);
        panel.Children.Add(_clientHint);
        panel.Children.Add(Text("After the install, accept this server in the CrowdSec console: the last page shows how.", 12, "Pro.Subtle"));
        _key.TextChanged += (_, _) => ShowKeyCheck();
        ShowKeyCheck();
        return panel;
    }

    private void ShowKeyCheck()
    {
        string text = _key.Text ?? "";
        if (text.Trim().Length == 0)
        {
            _keyCheck.Text = _enrolled ? "This server is already enrolled: leave it empty to keep that, or paste a new key to enroll it again." : "Required.";
            _keyCheck.Bind(TextBlock.ForegroundProperty, _enrolled ? "Pro.Subtle" : "Pro.WarningText");
        }
        else if (CrowdSecInstaller.KeyFrom(text) is { } key)
        {
            _keyCheck.Text = $"✓ Key found: {key[..Math.Min(6, key.Length)]}…";
            _keyCheck.Bind(TextBlock.ForegroundProperty, "Pro.SuccessText");
        }
        else
        {
            _keyCheck.Text = "No key found in that text: copy the key (or the whole command) again from the console.";
            _keyCheck.Bind(TextBlock.ForegroundProperty, "Pro.ErrorText");
        }
    }

    private (CrowdSecSettings? Settings, string? Problem) Read()
    {
        string name = (_name.Text ?? "").Trim();
        if (CrowdSecInstaller.NameProblem(name) is { } nameProblem) return (null, nameProblem);
        if (CrowdSecInstaller.KeyProblem(_key.Text ?? "", _enrolled) is { } keyProblem) return (null, keyProblem);
        (List<string> whitelist, string? problem) = Fail2BanInstaller.ParseWhitelist(_whitelist.Text ?? "");
        if (problem is not null) return (null, problem);
        return (new CrowdSecSettings(CrowdSecInstaller.KeyFrom(_key.Text ?? "") ?? "", name, whitelist), null);
    }

    public override string? Validate() => Read().Problem;

    protected override async Task<bool> DetectCoreAsync(ServerConnection connection)
    {
        CrowdSecState state = await Task.Run(() => CrowdSecInstaller.InspectAsync(connection));
        _enrolled = state.Enrolled;
        Site = state.Site;
        if (!_filled)
        {
            _name.Text = state.InstanceName ?? DefaultName(state.Site);
            IReadOnlyList<string> whitelist = state.Installed ? state.Whitelist : state.ClientIp is { } ip ? [ip] : [];
            _whitelist.Text = string.Join('\n', whitelist);
            _filled = true;
        }
        ShowKeyCheck();
        ShowCloudflare(state);
        _clientHint.Text = state.ClientIp is { } client
            ? $"This computer reaches the server from {client}." +
              (Fail2BanInstaller.ParseWhitelist(_whitelist.Text ?? "").Entries.Contains(client) ? "" : " It is not on the whitelist: add it, unless that address changes often.")
            : "Your own IP address could not be found: add it yourself (search \"what is my IP\").";
        if (CrowdSecInstaller.Problem(state) is { } problem)
        {
            Detected.Show(ResultKind.Warning, "The server is not ready for CrowdSec yet", problem);
            return false;
        }
        if (state.IsComplete)
        {
            Detected.Show(ResultKind.Success, $"CrowdSec {state.Version} protects the hotel through Traefik",
                $"{state.Banned.Count} address(es) banned by this server now. You can skip this step, or update CrowdSec (its data and enrollment stay).");
            return true;
        }
        Detected.Show(ResultKind.Info, state.Installed ? "CrowdSec is partly set up: running this step finishes it" : "CrowdSec will be installed",
            "In Docker next to Traefik, with the bouncer on every route.");
        return false;
    }

    private static string DefaultName(WebAccessSettings? site) =>
        site is null ? "hotel" : new string(site.Address.Where(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_').Take(64).ToArray()) is { Length: > 0 } name ? name : "hotel";

    private void ShowCloudflare(CrowdSecState state)
    {
        if (state.Site is not { } site) { _cloudflare.IsVisible = false; return; }
        _cloudflare.IsVisible = true;
        string dns = state.DnsAddresses is { } ips ? $" ({site.Address} points to {ips})" : "";
        if (site.IsIpAddress)
            _cloudflare.Show(ResultKind.Info, "No Cloudflare: the hotel is on an IP address",
                "Visitors connect straight to this server, so CrowdSec sees their own addresses.");
        else if (state.DnsBehindCloudflare == true && !site.Cloudflare)
            _cloudflare.Show(ResultKind.Error, "Cloudflare is used, but the hotel is not set up for it",
                $"{site.Address} is behind Cloudflare's proxy{dns}, but Web access was set up without Cloudflare. Run Install New Server → Web access again with Cloudflare on Yes first: " +
                "otherwise every visitor looks like Cloudflare, and a ban would block everyone.");
        else if (site.Cloudflare)
            _cloudflare.Show(state.DnsBehindCloudflare == false ? ResultKind.Warning : ResultKind.Success,
                state.DnsBehindCloudflare == false ? "Set up for Cloudflare, but the domain does not point to Cloudflare" : "Cloudflare is used: good",
                (state.DnsBehindCloudflare == false
                    ? $"{site.Address} does not point to Cloudflare{dns}: turn its proxy on (the orange cloud) in Cloudflare's DNS. CrowdSec works either way. "
                    : $"{site.Address} is behind Cloudflare's proxy{dns}. ") +
                "CrowdSec and the bouncer take the visitor's real address from Cloudflare's X-Forwarded-For, trusted only from Cloudflare's IP ranges (kept current weekly).");
        else
            _cloudflare.Show(ResultKind.Info, "No Cloudflare: visitors connect straight to this server",
                (state.DnsBehindCloudflare == false ? $"{site.Address} points straight to this server{dns}. " : "") + "CrowdSec sees the visitors' own addresses.");
    }

    protected override async Task<StepOutcome> RunCoreAsync(ServerConnection connection, Window owner)
    {
        Run.Log("> Checking the server ...");
        (CrowdSecSettings? settings, string? readProblem) = Read();
        if (settings is null) throw new ServerConnectionException(readProblem!);
        CrowdSecState state = await Task.Run(() => CrowdSecInstaller.InspectAsync(connection));
        if (CrowdSecInstaller.Problem(state) is { } problem) throw new ServerConnectionException(problem);
        WebAccessSettings site = state.Site!;
        Run.Log($"  {site.Url}, Cloudflare: {(site.Cloudflare ? "yes" : "no")}{(state.DnsAddresses is { } ips ? $" ({site.Address} → {ips})" : "")}; Docker and Traefik run");
        Run.Done(site.Cloudflare ? "Cloudflare" : "no Cloudflare");

        await Task.Run(() => CrowdSecInstaller.InstallEngineAsync(connection, settings, Run.Log));
        Run.Done("running");

        bool enrollNow = settings.EnrollKey.Length > 0;
        if (enrollNow) await Task.Run(() => CrowdSecInstaller.EnrollAsync(connection, settings.EnrollKey, settings.InstanceName, Run.Log));
        else Run.Log("  Already enrolled: kept");
        Run.Done(enrollNow ? "accept it in the console" : "kept");

        await Task.Run(() => CrowdSecInstaller.ConfigureTraefikAsync(connection, site, settings.Whitelist, Run.Log));
        Run.Done("every route");

        CrowdSecResult result = await Task.Run(() => CrowdSecInstaller.TestAsync(connection, site, Run.Log));
        Run.Done(result.BouncerConnected ? "connected" : "not connected yet");

        Site = site;
        InstanceName = settings.InstanceName;
        EnrolledNow = enrollNow;
        Result = result;
        string accept = enrollNow ? $" Now accept \"{settings.InstanceName}\" in the CrowdSec console (app.crowdsec.net): see the next page." : "";
        return result.BouncerConnected
            ? await SucceededAsync("CrowdSec protects the hotel", $"Every request through Traefik is checked; banned addresses get 403.{accept}")
            : await SucceededWithWarningAsync("CrowdSec runs, but the bouncer has not connected yet",
                $"Traefik's plugin fetches the ban list once a minute: check Debug → Traefik for crowdsec lines.{accept}");
    }
}
