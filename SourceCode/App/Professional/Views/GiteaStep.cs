using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using AllInOneInstaller.Configuration;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>Gitea, your own Git server, in Docker behind the hotel's Traefik on a domain of its own.</summary>
public sealed class GiteaStep : InstallStep
{
    private readonly TextBox _domain = new() { MinWidth = 320, PlaceholderText = "git.example.com" };
    private readonly RadioButton _cloudflareYes = new() { GroupName = "giteacf", Content = "Yes: the domain is in Cloudflare, with its proxy on (orange cloud)" };
    private readonly RadioButton _cloudflareNo = new() { GroupName = "giteacf", Content = "No: the A record points straight to this server", IsChecked = true };
    private readonly TextBox _adminUser = new() { MinWidth = 220, MaxLength = 40, Text = "gitadmin", PlaceholderText = "gitadmin" };
    private readonly TextBox _adminEmail = new() { MinWidth = 320, PlaceholderText = "you@example.com" };
    private readonly ResultBanner _dnsWarning = new();
    private WebAccessSettings? _site;

    /// <summary>Set after a run, for the finished page.</summary>
    public GiteaSettings? Settings { get; private set; }
    public GiteaResult? Result { get; private set; }

    public override string Title => "Gitea";
    public override string Caption => "Your own Git server";
    public override string InstallLabel => "Install Gitea";
    public override string RerunLabel => "Update Gitea";

    public GiteaStep() : base(Icons.Git,
        "Install Gitea",
        "Gitea (gitea.com) is a light, easy Git server of your own, like a small GitHub: repositories, issues and pull requests for your hotel's code, on a domain of its own such as git.example.com.",
        [
            $"Runs Gitea in Docker ({GiteaInstaller.Directory}, image {GiteaInstaller.Image}) with SQLite: no database to set up. Repositories and settings stay in {GiteaInstaller.Directory}/data.",
            $"Its web port is only on 127.0.0.1 (the first free port from {LocalPorts.First} to {LocalPorts.Last}); Traefik answers for the domain and gets a Let's Encrypt certificate, as for the hotel.",
            "Clone and push over https (with your Gitea password or a token). Gitea's SSH stays off: Cloudflare's proxy does not pass SSH, and the server's own SSH stays apart.",
            "Creates the admin account with a random password, shown at the end. Registration is off (no Register button): the admin makes the accounts. The start page is the repository list (/explore/repos).",
            "Running this again updates Gitea; the repositories and accounts stay."
        ],
        "Run the Web access step first (Docker and Traefik).",
        [
            "Check the server and the domain",
            "Gitea in Docker and the Traefik route",
            "Test through Traefik"
        ])
    {
    }

    protected override Control BuildOptions()
    {
        var panel = new StackPanel { Spacing = 8, Margin = new Thickness(0, 8, 0, 0) };
        panel.Children.Add(_dnsWarning);
        panel.Children.Add(Text("Domain name for Gitea", 12, "Pro.Muted", FontWeight.SemiBold));
        panel.Children.Add(_domain);
        panel.Children.Add(Text("A name of its own, not the hotel's: for a hotel on example.com, use git.example.com.", 12, "Pro.Subtle"));
        panel.Children.Add(Text("Is the domain behind Cloudflare?", 12, "Pro.Muted", FontWeight.SemiBold));
        panel.Children.Add(_cloudflareYes);
        panel.Children.Add(_cloudflareNo);
        panel.Children.Add(Text("Admin account", 12, "Pro.Muted", FontWeight.SemiBold));
        var admin = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        admin.Children.Add(_adminUser);
        admin.Children.Add(_adminEmail);
        panel.Children.Add(admin);
        panel.Children.Add(Text("Its password is made at random and shown at the end. Gitea keeps the name \"admin\" for itself.", 12, "Pro.Subtle"));
        _domain.TextChanged += (_, _) => ShowDnsWarning();
        _cloudflareYes.IsCheckedChanged += (_, _) => ShowDnsWarning();
        ShowDnsWarning();
        return panel;
    }

    // Before anything else: without the A record Let's Encrypt cannot give Gitea a certificate.
    private void ShowDnsWarning()
    {
        string domain = (_domain.Text ?? "").Trim() is { Length: > 0 } d ? d : "git.example.com";
        _dnsWarning.Show(ResultKind.Warning, $"First add {domain} to your DNS as an A record",
            $"Point the A record of {domain} to this server's IP address" +
            (_cloudflareYes.IsChecked == true
                ? ", and in Cloudflare turn its proxy on (the orange cloud). "
                : ". With Cloudflare, turn its proxy on (the orange cloud) and choose Yes below. ") +
            "Do this before installing: without it Let's Encrypt cannot give Gitea its certificate. The step checks it first.");
    }

    public override string? Validate()
    {
        string domain = (_domain.Text ?? "").Trim().TrimEnd('.').ToLowerInvariant();
        _domain.Text = domain;
        if (GiteaInstaller.DomainProblem(domain, _site) is { } domainProblem) return domainProblem;
        string user = (_adminUser.Text ?? "").Trim();
        _adminUser.Text = user;
        if (GiteaInstaller.UserProblem(user) is { } userProblem) return userProblem;
        string email = (_adminEmail.Text ?? "").Trim();
        _adminEmail.Text = email;
        return GiteaInstaller.EmailProblem(email);
    }

    protected override async Task<bool> DetectCoreAsync(ServerConnection connection)
    {
        GiteaState state = await Task.Run(() => GiteaInstaller.InspectAsync(connection));
        _site = state.Site;
        if (string.IsNullOrWhiteSpace(_domain.Text)) _domain.Text = state.Domain ?? GiteaInstaller.SuggestedDomain(state.Site);
        if (state.Cloudflare ?? state.Site?.Cloudflare ?? false) _cloudflareYes.IsChecked = true;
        if (string.IsNullOrWhiteSpace(_adminEmail.Text) && (_domain.Text ?? "").Split('.', 2) is [_, var parent] && parent.Contains('.'))
            _adminEmail.Text = $"admin@{parent}";
        if (Missing(state) is { } missing)
        {
            Detected.Show(ResultKind.Warning, "The server is not ready for Gitea yet", missing);
            return false;
        }
        if (state.Installed)
        {
            Detected.Show(ResultKind.Success, $"Gitea {state.Version} runs on {(state.Site!.Https ? "https" : "http")}://{state.Domain}",
                "You can skip this step, or update Gitea (its repositories and accounts stay).");
            return true;
        }
        Detected.Show(ResultKind.Info, "Gitea will be installed",
            $"In Docker next to Traefik, {(state.Site!.Https ? "with a Let's Encrypt certificate" : "over http, like the hotel")}.");
        return false;
    }

    private static string? Missing(GiteaState state) =>
        state.Site is null ? "Run the Web access step first: Gitea uses its Docker and Traefik."
        : !state.DockerRunning ? "Docker does not run: run the Web access step first."
        : !state.TraefikRunning ? "Traefik does not run: run the Web access step first."
        : null;

    protected override async Task<StepOutcome> RunCoreAsync(ServerConnection connection, Window owner)
    {
        Run.Log("> Checking the server ...");
        GiteaState state = await Task.Run(() => GiteaInstaller.InspectAsync(connection));
        if (Missing(state) is { } missing) throw new ServerConnectionException(missing);
        var settings = new GiteaSettings((_domain.Text ?? "").Trim(), state.Site!.Https, _cloudflareYes.IsChecked == true,
            (_adminUser.Text ?? "").Trim(), (_adminEmail.Text ?? "").Trim());
        Run.Log($"  {settings.Url}, Cloudflare: {(settings.Cloudflare ? "yes" : "no")}, Docker and Traefik run");
        await Task.Run(() => GiteaInstaller.CheckDnsAsync(connection, settings, Run.Log));
        Run.Done(settings.Domain);

        GiteaResult result = await Task.Run(() => GiteaInstaller.InstallAsync(connection, settings, Run.Log));
        Run.Done($"port {result.Port}");

        bool certificate = await Task.Run(() => GiteaInstaller.TestAsync(connection, settings, Run.Log));
        Run.Done(certificate ? "OK" : "no certificate yet");

        Settings = settings;
        Result = result with { CertificateValid = certificate };
        if (result.AdminPassword is { } password)
        {
            SaveLogin(connection.Login.Host, settings, password);
            Run.Extra.Content = FinishedView.CopyBox(password);
        }
        string login = result.AdminPassword is not null
            ? $"Log in as {settings.AdminUser} with the password below (also saved on this computer in {GiteaLoginPath(connection.Login.Host)})."
            : "The admin account was there already and is kept.";
        return certificate
            ? await SucceededAsync($"Gitea runs on {settings.Url}", login)
            : await SucceededWithWarningAsync($"Gitea runs, but {settings.Domain} has no certificate yet",
                $"Check the A record of {settings.Domain}{(settings.Cloudflare ? " (proxy on)" : "")}; Traefik keeps trying. {login}");
    }

    public static string GiteaLoginPath(string host) =>
        Path.Combine(Path.GetDirectoryName(ClientConfiguration.DatabaseCredentialsPath(host))!, "gitea.txt");

    // Next to the MariaDB passwords, so the encrypted settings backup takes it along.
    private static void SaveLogin(string host, GiteaSettings settings, string password)
    {
        string path = GiteaLoginPath(host);
        File.WriteAllText(path, $"# Gitea admin (All-in-1 Installer)\nurl={settings.Url}\nuser={settings.AdminUser}\nemail={settings.AdminEmail}\npassword={password}\n");
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
    }
}
