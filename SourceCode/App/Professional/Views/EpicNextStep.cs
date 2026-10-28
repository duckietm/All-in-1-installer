using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using AllInOneInstaller.Configuration;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>EpicNext CMS becomes the hotel's website, as AtomCMS does: Next.js on the server itself (not Docker), Octane on /client/.</summary>
public sealed class EpicNextStep : InstallStep
{
    private enum ExistingFolderChoice { MoveAside, Abort }

    private readonly TextBox _gitUrl = new() { MinWidth = 460, Text = EpicNextInstaller.Repository, PlaceholderText = EpicNextInstaller.Repository };
    private readonly TextBox _branch = new() { MinWidth = 220, MaxLength = 100, PlaceholderText = "default branch" };
    private readonly TextBox _folder = new() { MinWidth = 220, MaxLength = 200, Text = EpicNextInstaller.RepositoryFolder, PlaceholderText = "top folder" };
    private readonly TextBox _hotelName = new() { MinWidth = 380, MaxLength = 100, PlaceholderText = "My Hotel" };

    /// <summary>Set after a run, for the finished page.</summary>
    public bool AtomTables { get; private set; }

    public override string Title => "EpicNext CMS";
    public override string Caption => "CMS & /client";
    public override string InstallLabel => "Install EpicNext";
    public override string RerunLabel => "Update and build again";

    public EpicNextStep() : base(Icons.Puzzle,
        "Install EpicNext CMS",
        "EpicNext CMS (Next.js) becomes the hotel's website, the same way as AtomCMS: visitors register and log in there, and it opens Octane on /client. It runs on the server itself, not in Docker.",
        [
            $"Gets EpicNext from git into {EpicNextInstaller.Directory}: by default the {EpicNextInstaller.RepositoryFolder} folder of the installer's own repository (its routes on /cms_api, so /api stays Polaris'). Later runs update it.",
            $"Node.js {EpicNextInstaller.NodeMinimum} or newer and pnpm (through corepack), then pnpm install, pnpm db:migrate (only EpicNext's own tables) and pnpm build, under its memory cap.",
            $".env: the hotel database with the cms login of the server installation, the site's address, a random AUTH_SECRET and RCON. Settings: the client URL (/client/index.html, Octane on this site) and the gamedata folder ({OctaneInstaller.Gamedata}). users.password is widened for EpicNext's password hashes.",
            $"Runs as the systemd service {EpicNextInstaller.Service} (user www-data, {EpicNextInstaller.Upstream}, started at boot). No PHP.",
            $"NGINX passes the site to it on its own port (the first free one from {CmsSite.FirstPort} to {CmsSite.LastPort}); Octane moves to /client/ with its login screen off; Traefik sends only Polaris' own /api paths to the emulator."
        ],
        "Run the full server installation first (at least NGINX, MariaDB, Dev tools, the clones, Emulator, Web access and Octane). The build needs about 3 GB of free memory and 5 GB of free disk space. One CMS is the website at a time: this replaces AtomCMS or your own CMS as the site (their files stay).",
        [
            "Check the server",
            "Get EpicNext",
            "Node.js, pnpm and .env",
            "pnpm install, migrate and build",
            "Octane on /client: configure and build",
            "Start EpicNext, NGINX (own port) and Traefik",
            "Test the CMS, /client and /api"
        ])
    {
    }

    protected override Control BuildOptions()
    {
        var panel = new StackPanel { Spacing = 8, Margin = new Thickness(0, 8, 0, 0) };
        panel.Children.Add(Text("Hotel name", 12, "Pro.Muted", FontWeight.SemiBold));
        panel.Children.Add(_hotelName);
        panel.Children.Add(Text("Repository", 12, "Pro.Muted", FontWeight.SemiBold));
        panel.Children.Add(_gitUrl);
        var where = new StackPanel { Orientation = Avalonia.Layout.Orientation.Horizontal, Spacing = 8 };
        var branch = new StackPanel { Spacing = 4 };
        branch.Children.Add(Text("Branch", 12, "Pro.Muted", FontWeight.SemiBold));
        branch.Children.Add(_branch);
        var folder = new StackPanel { Spacing = 4 };
        folder.Children.Add(Text("Folder in the repository", 12, "Pro.Muted", FontWeight.SemiBold));
        folder.Children.Add(_folder);
        where.Children.Add(branch);
        where.Children.Add(folder);
        panel.Children.Add(where);
        panel.Children.Add(Text($"The https link of the repository (it must be public), the branch (empty: its default branch) and the folder with EpicNext's package.json (empty: the top folder). " +
                                $"By default: {EpicNextInstaller.RepositoryFolder} in the installer's repository.", 12, "Pro.Subtle"));
        return panel;
    }

    public override string? Validate()
    {
        string name = (_hotelName.Text ?? "").Trim();
        if (name.Length == 0) return "Enter the hotel's name.";
        if (name.Any(char.IsControl)) return "The hotel's name cannot contain line breaks or tabs.";
        _hotelName.Text = name;
        string url = (_gitUrl.Text ?? "").Trim();
        _gitUrl.Text = url;
        if (CustomCmsInstaller.GitUrlProblem(url) is { } urlProblem) return urlProblem;
        string branch = (_branch.Text ?? "").Trim();
        _branch.Text = branch;
        if (EpicNextInstaller.BranchProblem(branch) is { } branchProblem) return "Branch: " + branchProblem;
        string folder = (_folder.Text ?? "").Trim().Trim('/');
        _folder.Text = folder;
        return EpicNextInstaller.FolderProblem(folder) is { } folderProblem ? "Folder: " + folderProblem : null;
    }

    protected override async Task<bool> DetectCoreAsync(ServerConnection connection)
    {
        EpicNextState state = await Task.Run(() => EpicNextInstaller.InspectAsync(connection));
        if (string.IsNullOrWhiteSpace(_hotelName.Text))
            _hotelName.Text = state.HotelName is { Length: > 0 } name ? name
                : state.Server.HotelName is { Length: > 0 } atomName && atomName != "Atom CMS" ? atomName
                : state.Site is { IsIpAddress: false } site && HardenInstaller.WhitelistHost(site).Split('.')[0] is { Length: > 0 } host
                    ? char.ToUpperInvariant(host[0]) + host[1..] + " Hotel" : "";
        if (state.Origin is { Length: > 0 } origin)
        {
            // What the last run used: a folder of a repository, or a clone of a repository of its own.
            _gitUrl.Text = origin;
            _branch.Text = state.SourceBranch ?? "";
            _folder.Text = state.SourceFolder ?? "";
        }
        if (Missing(state.Server) is { } missing)
        {
            Detected.Show(ResultKind.Warning, "The server is not ready for EpicNext yet", missing);
            return false;
        }
        WebAccessSettings current = state.Site!;
        string atom = state.AtomTables
            ? " The hotel database has AtomCMS' tables: EpicNext also uses website_* tables, so tables with the same name keep AtomCMS' layout. EpicNext works best on a database without AtomCMS."
            : "";
        if (state.Installed)
            Detected.Show(ResultKind.Success, $"EpicNext is the website of {current.Url}",
                $"Octane is on {current.ClientUrl}. Run this step again to update EpicNext (git pull, pnpm install, migrate and build).");
        else
            Detected.Show(state.AtomTables ? ResultKind.Warning : ResultKind.Info, $"EpicNext will be the website of {current.Url}",
                $"Octane moves to {current.Url}/client/." + (current.HasCms ? $" {current.CmsName} is the website now: EpicNext takes its place (its files stay)." : "") + atom);
        return state.Installed;
    }

    private static string? Missing(AtomCmsState state) =>
        state.Site is null ? "Run the Web access step first: EpicNext is set up for the address chosen there."
        : state.NodeVersion is null ? "Node.js is missing: run the Dev tools step first."
        : !state.EmulatorConfigured ? "The emulator is not set up: run the Emulator step first."
        : !state.OctaneBuilt ? "Octane is not built yet: run the Octane step first."
        : null;

    protected override async Task<StepOutcome> RunCoreAsync(ServerConnection connection, Window owner)
    {
        string hotelName = (_hotelName.Text ?? "").Trim();
        string url = (_gitUrl.Text ?? "").Trim();
        string branch = (_branch.Text ?? "").Trim();
        string folder = (_folder.Text ?? "").Trim().Trim('/');
        string directory = EpicNextInstaller.Directory;

        Run.Log("> Checking the server ...");
        EpicNextState state = await Task.Run(() => EpicNextInstaller.InspectAsync(connection));
        if (Missing(state.Server) is { } missing) throw new ServerConnectionException(missing);
        WebAccessSettings site = state.Site! with { AtomCms = false, CustomCms = null, EpicNext = true };
        Run.Log($"  {site.Url}: Node.js {state.Server.NodeVersion}, Octane built");
        if (state.AtomTables) Run.Log("  WARNING: the hotel database has AtomCMS' website_* tables; EpicNext's tables with the same name keep AtomCMS' layout.");
        DatabaseCredentials? credentials = ClientConfiguration.LoadDatabaseCredentials(connection.Login.Host);
        if (credentials is null) Run.Log("  The MariaDB passwords of this server are not saved on this computer: the step looks for a database login on the server.");
        Run.Done(site.Url);

        await Task.Run(() => CustomCmsInstaller.CheckGitAccessAsync(connection, url, Run.Log));
        string commit;
        if (folder.Length > 0)
        {
            // EpicNext is a folder of a larger repository (by default the installer's own).
            commit = await Task.Run(() => EpicNextInstaller.GetFromFolderAsync(connection, url, branch, folder, Run.Log));
        }
        else
        {
            CloneState clone = await Task.Run(() => GitCloneInstaller.InspectAsync(connection, url, directory));
            if (clone.Kind == CloneTargetKind.OtherContent && !await MoveAsideAsync(connection, owner, directory,
                    clone.Origin is null ? "It is not a clone of EpicNext." : $"It is a clone of {clone.Origin}.")) return Aborted(connection);
            string? wanted = branch.Length > 0 ? branch : null;
            commit = clone.Kind == CloneTargetKind.SameRepository
                ? await Task.Run(() => GitCloneInstaller.UpdateAsync(connection, directory, wanted, Run.Log))
                : await Task.Run(() => GitCloneInstaller.CloneAsync(connection, url, directory, wanted, Run.Log));
        }
        Run.Done(commit);

        await Task.Run(() => EpicNextInstaller.PrepareToolsAsync(connection, Run.Log));
        await Task.Run(() => EpicNextInstaller.ConfigureEnvAsync(connection, site, hotelName, credentials, Run.Log));
        Run.Done(".env");

        await Task.Run(() => EpicNextInstaller.BuildAsync(connection, Run.Log));
        Run.Done("built");

        // Octane is configured and built for /client/ before the site switches, so it is never served half-way.
        await Task.Run(() => OctaneInstaller.ConfigureAsync(connection, site, Run.Log));
        await Task.Run(() => OctaneInstaller.BuildAsync(connection, site, Run.Log));
        Run.Done(site.ClientUrl);

        await Task.Run(() => EpicNextInstaller.StartServiceAsync(connection, Run.Log));
        int port = await Task.Run(() => CmsSite.ApplyAsync(connection, site, EpicNextInstaller.SiteName, directory, php: false, Run.Log,
            proxy: EpicNextInstaller.Upstream));
        site = site with { CmsPort = port };
        await Task.Run(() => WebAccessInstaller.ConfigureRoutesAsync(connection, site, Run.Log));
        await Task.Run(() => OctaneInstaller.PublishAsync(connection, site, Run.Log));
        Run.Done($"EpicNext on / (port {port}), Octane on /client/");

        await Task.Run(() => EpicNextInstaller.TestAsync(connection, site, Run.Log));
        Run.Done("OK");

        AtomTables = state.AtomTables;
        return await SucceededAsync($"EpicNext is the website of {site.Url}",
            $"Register on {site.Url}/register, make that account admin (rank 7) and set the client URL in Admin → CMS Settings: see the next page.");
    }

    private async Task<bool> MoveAsideAsync(ServerConnection connection, Window owner, string directory, string reason)
    {
        Run.Busy = false;
        ExistingFolderChoice choice = await ChoiceDialog.ShowAsync(owner, "Folder not empty", $"{directory} already has other content", reason,
            ExistingFolderChoice.Abort,
            new ChoiceDialog.Option<ExistingFolderChoice>("Move it aside and continue",
                $"{directory} is renamed to {directory}.bak-<date>; nothing is deleted.", ExistingFolderChoice.MoveAside, Primary: true),
            new ChoiceDialog.Option<ExistingFolderChoice>("Abort installation", "Changes nothing on the server.", ExistingFolderChoice.Abort));
        Run.Busy = true;
        if (choice == ExistingFolderChoice.Abort) return false;
        await Task.Run(() => GitCloneInstaller.MoveAsideAsync(connection, directory, Run.Log));
        return true;
    }
}
