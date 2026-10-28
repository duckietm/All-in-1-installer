using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Platform.Storage;
using AllInOneInstaller.Configuration;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>Your own CMS becomes the hotel's website, as AtomCMS does: from a Git link or a ZIP; Octane moves to /client/.</summary>
public sealed class CustomCmsStep : InstallStep
{
    private enum ExistingFolderChoice { MoveAside, Abort }

    private readonly RadioButton _fromGit = new() { GroupName = "cmssource", Content = "A GitHub link (the server clones it; later runs update it with git pull)", IsChecked = true };
    private readonly RadioButton _fromZip = new() { GroupName = "cmssource", Content = "A ZIP file with the whole CMS, from this computer" };
    private readonly TextBox _gitUrl = new() { MinWidth = 460, PlaceholderText = "https://github.com/owner/cms.git" };
    private readonly TextBlock _zipFile = Text("No ZIP file chosen yet.", 12.5, "Pro.Muted");
    private readonly Button _chooseZip = new() { Content = "Choose ZIP ...", Padding = new Thickness(14, 7), Classes = { "secondary" } };
    private string? _zipPath;
    private readonly TextBox _name = new() { MinWidth = 220, MaxLength = CustomCmsInstaller.MaxNameLength, PlaceholderText = "mycms" };
    private readonly TextBlock _namePath = Text("", 12, "Pro.Subtle");
    private readonly RadioButton _php = new() { GroupName = "cmskind", Content = "PHP: the CMS has .php files (Laravel, WordPress, most retro CMSes)", IsChecked = true };
    private readonly RadioButton _static = new() { GroupName = "cmskind", Content = "Static: only HTML, CSS, JavaScript and images, no PHP" };
    private readonly TextBox _root = new() { MinWidth = 220, Text = "/public", PlaceholderText = "/public" };
    private readonly StackPanel _gitPanel = new() { Spacing = 6 };
    private readonly StackPanel _zipPanel = new() { Spacing = 6, IsVisible = false };

    /// <summary>Set after a run, for the finished page.</summary>
    public string? CmsName { get; private set; }
    public string? CmsRoot { get; private set; }
    public bool CmsUsesPhp { get; private set; }

    public override string Title => "Your CMS";
    public override string Caption => "CMS & /client";
    public override string InstallLabel => "Install the CMS";
    public override string RerunLabel => "Update and set up again";

    public CustomCmsStep() : base(Icons.Puzzle,
        "Install your own CMS",
        "Your own CMS becomes the hotel's website, the same way as AtomCMS: visitors use the CMS, and the CMS opens Octane on /client.",
        [
            $"Gets your CMS: clones the GitHub link, or unpacks your ZIP, into {CustomCmsInstaller.Parent}/<folder name>.",
            "Octane moves to /client: vite --base=/client/, client-mode.json with /client/configuration/, its login screen off (the CMS logs in), and a rebuild.",
            $"NGINX serves the CMS from its root folder on its own port (the first free one from {CmsSite.FirstPort} to {CmsSite.LastPort}), with PHP 8.5 or as a static website.",
            "Traefik sends the site to the CMS, /client and /gamedata to the hotel site, and only Polaris' own /api paths to the emulator: the CMS keeps the rest of /api.",
            "The database settings of your CMS are yours to fill in: the end of this step shows the database login to use."
        ],
        "Run the full server installation first (at least NGINX, PHP, MariaDB, the clones, Emulator, Web access and Octane). One CMS is the website at a time: this replaces AtomCMS as the site (its files stay).",
        [
            "Check the server",
            "Get the CMS",
            "Check the root folder",
            "Octane on /client: configure and build",
            "NGINX (own port) and Traefik",
            "Test the CMS, /client and /api"
        ])
    {
    }

    protected override Control BuildOptions()
    {
        var panel = new StackPanel { Spacing = 8, Margin = new Thickness(0, 8, 0, 0) };

        panel.Children.Add(Text("Where does your CMS come from?", 12, "Pro.Muted", FontWeight.SemiBold));
        panel.Children.Add(_fromGit);
        panel.Children.Add(_fromZip);
        _gitPanel.Children.Add(_gitUrl);
        _gitPanel.Children.Add(Text("The https link of the repository. It must be public: for a private one, download it as a ZIP and choose ZIP.", 12, "Pro.Subtle"));
        panel.Children.Add(_gitPanel);
        var zipRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        zipRow.Children.Add(_chooseZip);
        _zipFile.VerticalAlignment = VerticalAlignment.Center;
        zipRow.Children.Add(_zipFile);
        _zipPanel.Children.Add(zipRow);
        panel.Children.Add(_zipPanel);
        _fromGit.IsCheckedChanged += (_, _) => ShowSource();
        _fromZip.IsCheckedChanged += (_, _) => ShowSource();
        _chooseZip.Click += async (_, _) => await ChooseZipAsync();
        _gitUrl.LostFocus += (_, _) =>
        {
            // The repository's name is a good folder name.
            if (string.IsNullOrWhiteSpace(_name.Text) && (_gitUrl.Text ?? "").Trim() is { Length: > 0 } url)
                _name.Text = CustomCmsInstaller.NameFromUrl(url);
        };

        panel.Children.Add(Text("Folder name on the server", 12, "Pro.Muted", FontWeight.SemiBold));
        panel.Children.Add(_name);
        panel.Children.Add(Text($"Lower case letters and digits only (a-z, 0-9): no spaces, capitals or other characters, at most {CustomCmsInstaller.MaxNameLength}.", 12, "Pro.Subtle"));
        panel.Children.Add(_namePath);
        _name.TextChanged += (_, _) => _namePath.Text = (_name.Text ?? "").Trim() is { Length: > 0 } n ? $"The CMS goes to {CustomCmsInstaller.Directory(n)}" : "";

        panel.Children.Add(Text("Does the website use PHP?", 12, "Pro.Muted", FontWeight.SemiBold));
        panel.Children.Add(_php);
        panel.Children.Add(_static);

        panel.Children.Add(Text("Root folder", 12, "Pro.Muted", FontWeight.SemiBold));
        panel.Children.Add(_root);
        var explain = Text("The root is the folder inside your CMS that visitors' browsers get: the one with the start page (index.php or index.html). " +
                           "Everything outside it, such as the settings with passwords, stays hidden. Laravel-based CMSes (like AtomCMS) use /public. " +
                           "When the start page is in the top folder of your CMS, enter just /.", 12, "Pro.Subtle");
        explain.TextWrapping = TextWrapping.Wrap;
        explain.MaxWidth = 700;
        explain.HorizontalAlignment = HorizontalAlignment.Left;
        panel.Children.Add(explain);
        return panel;
    }

    private void ShowSource()
    {
        _gitPanel.IsVisible = _fromGit.IsChecked == true;
        _zipPanel.IsVisible = _fromZip.IsChecked == true;
    }

    private async Task ChooseZipAsync()
    {
        if (TopLevel.GetTopLevel(_chooseZip) is not { } top) return;
        IReadOnlyList<IStorageFile> files = await top.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = "Select the ZIP file with your CMS",
            AllowMultiple = false,
            FileTypeFilter = [new FilePickerFileType("ZIP files") { Patterns = ["*.zip"] }, new FilePickerFileType("All files") { Patterns = ["*"] }]
        });
        if (files.Count == 0 || files[0].TryGetLocalPath() is not { } path) return;
        _zipPath = path;
        _zipFile.Text = $"{Path.GetFileName(path)} ({new FileInfo(path).Length / (1024.0 * 1024):0.0} MB)";
    }

    public override string? Validate()
    {
        string name = (_name.Text ?? "").Trim();
        _name.Text = name;
        if (_fromGit.IsChecked == true)
        {
            string url = (_gitUrl.Text ?? "").Trim();
            _gitUrl.Text = url;
            if (url.Length == 0) return "Enter the GitHub link of your CMS.";
            if (CustomCmsInstaller.GitUrlProblem(url) is { } urlProblem) return urlProblem;
        }
        else if (_zipPath is null || !File.Exists(_zipPath)) return "Choose the ZIP file with your CMS.";
        if (CustomCmsInstaller.NameProblem(name) is { } nameProblem) return "Folder name: " + nameProblem;
        string root = (_root.Text ?? "").Trim();
        if (root.Length == 0) root = "/";
        if (!root.StartsWith('/')) root = "/" + root;
        _root.Text = CustomCmsInstaller.NormalizeRoot(root);
        return CustomCmsInstaller.RootProblem(_root.Text) is { } rootProblem ? "Root folder: " + rootProblem : null;
    }

    protected override async Task<bool> DetectCoreAsync(ServerConnection connection)
    {
        CustomCmsState state = await Task.Run(() => CustomCmsInstaller.InspectAsync(connection, null));
        // What is set up already fills the form in, for an update.
        if (state.CurrentName is { } current && string.IsNullOrWhiteSpace(_name.Text))
        {
            _name.Text = current;
            if (state.CurrentRoot is { } root) _root.Text = root;
            if (state.CurrentPhp is { } php) (php ? _php : _static).IsChecked = true;
        }
        if (Missing(state.Server, _php.IsChecked == true) is { } missing)
        {
            Detected.Show(ResultKind.Warning, "The server is not ready for a CMS yet", missing);
            return false;
        }
        WebAccessSettings site = state.Site!;
        if (state.CurrentName is { } name)
            Detected.Show(ResultKind.Success, $"Your CMS ({CustomCmsInstaller.Directory(name)}) is the website of {site.Url}",
                $"Octane is on {site.ClientUrl}. Run this step again to update it (git pull, or a new ZIP) and set it up again.");
        else
            Detected.Show(ResultKind.Info, $"Your CMS will be the website of {site.Url}",
                $"Octane moves to {site.Url}/client/." + (site.HasCms ? $" {site.CmsName} is the website now: your CMS takes its place (its files stay)." : ""));
        return false;
    }

    private static string? Missing(AtomCmsState state, bool php) =>
        state.Site is null ? "Run the Web access step first: the CMS is set up for the address chosen there."
        : php && state.PhpVersion is null ? "PHP 8.5 is not installed: run the PHP step first (or choose a static website)."
        : state.NodeVersion is null ? "Node.js is missing: run the Dev tools step first (Octane is rebuilt for /client)."
        : !state.EmulatorConfigured ? "The emulator is not set up: run the Emulator step first."
        : !state.OctaneBuilt ? "Octane is not built yet: run the Octane step first."
        : null;

    protected override async Task<StepOutcome> RunCoreAsync(ServerConnection connection, Window owner)
    {
        string name = (_name.Text ?? "").Trim();
        string root = CustomCmsInstaller.NormalizeRoot(_root.Text ?? "/");
        bool php = _php.IsChecked == true;
        bool git = _fromGit.IsChecked == true;
        string url = (_gitUrl.Text ?? "").Trim();
        string directory = CustomCmsInstaller.Directory(name);

        Run.Log("> Checking the server ...");
        CustomCmsState state = await Task.Run(() => CustomCmsInstaller.InspectAsync(connection, name));
        if (Missing(state.Server, php) is { } missing) throw new ServerConnectionException(missing);
        WebAccessSettings site = state.Site! with { AtomCms = false, CustomCms = name, EpicNext = false };
        Run.Log($"  {site.Url}: {(php ? $"PHP {state.Server.PhpVersion}" : "static website")}, Octane built");
        Run.Done(site.Url);

        if (git)
        {
            await Task.Run(() => CustomCmsInstaller.CheckGitAccessAsync(connection, url, Run.Log));
            CloneState clone = await Task.Run(() => GitCloneInstaller.InspectAsync(connection, url, directory));
            if (clone.Kind == CloneTargetKind.OtherContent && !await MoveAsideAsync(connection, owner, directory,
                    clone.Origin is null ? "It is not a clone of that link." : $"It is a clone of {clone.Origin}.")) return Aborted(connection);
            string commit = clone.Kind == CloneTargetKind.SameRepository
                ? await Task.Run(() => GitCloneInstaller.UpdateAsync(connection, directory, null, Run.Log))
                : await Task.Run(() => GitCloneInstaller.CloneAsync(connection, url, directory, null, Run.Log));
            Run.Done(commit);
        }
        else
        {
            if (state.FolderHasContent && !await MoveAsideAsync(connection, owner, directory, "The ZIP is unpacked into an empty folder."))
                return Aborted(connection);
            string remote = $"/root/cms-upload-{DateTime.Now:yyyyMMdd-HHmmss}.zip";
            long bytes = new FileInfo(_zipPath!).Length;
            Run.Log($"> Uploading {Path.GetFileName(_zipPath)} ({bytes / (1024.0 * 1024):0.0} MB) to {remote}");
            int reported = 0;
            await connection.UploadAsync(_zipPath!, remote, done =>
            {
                int percent = bytes > 0 ? (int)((long)done * 100 / bytes) : 0;
                if (percent < reported + 20) return;
                reported = percent / 20 * 20;
                Run.Log($"  {reported} %");
            });
            await Task.Run(() => CustomCmsInstaller.ExtractZipAsync(connection, remote, name, Run.Log));
            Run.Done(Path.GetFileName(_zipPath!));
        }

        await Task.Run(() => CustomCmsInstaller.PrepareAsync(connection, name, root, php, Run.Log));
        Run.Done(CustomCmsInstaller.RootPath(name, root));

        // Octane is configured and built for /client/ before the site switches, so it is never served half-way.
        await Task.Run(() => OctaneInstaller.ConfigureAsync(connection, site, Run.Log));
        await Task.Run(() => OctaneInstaller.BuildAsync(connection, site, Run.Log));
        Run.Done(site.ClientUrl);

        int port = await Task.Run(() => CmsSite.ApplyAsync(connection, site, name, CustomCmsInstaller.RootPath(name, root), php, Run.Log));
        site = site with { CmsPort = port };
        await Task.Run(() => WebAccessInstaller.ConfigureRoutesAsync(connection, site, Run.Log));
        await Task.Run(() => OctaneInstaller.PublishAsync(connection, site, Run.Log));
        Run.Done($"CMS on / (port {port}), Octane on /client/");

        await Task.Run(() => CustomCmsInstaller.TestAsync(connection, site, Run.Log));
        Run.Done("OK");

        CmsName = name;
        CmsRoot = root;
        CmsUsesPhp = php;
        DatabaseCredentials? credentials = ClientConfiguration.LoadDatabaseCredentials(connection.Login.Host);
        Run.Extra.Content = FinishedView.CmsDatabaseLogin(credentials, connection.Login.Host);
        return await SucceededWithWarningAsync($"Your CMS is the website of {site.Url}",
            "Fill in the database settings of your CMS yourself (its .env or config file): the installer cannot do that for a CMS it does not know. " +
            "Use the cms database login below, which the server installation made. Octane is on " + site.ClientUrl + ".");
    }

    private async Task<bool> MoveAsideAsync(ServerConnection connection, Window owner, string directory, string reason)
    {
        Run.Busy = false;
        ExistingFolderChoice choice = await ChoiceDialog.ShowAsync(owner, "Folder not empty", $"{directory} already has other content", reason,
            ExistingFolderChoice.Abort,
            new ChoiceDialog.Option<ExistingFolderChoice>("Move it aside and continue",
                $"{directory} is renamed to {directory}.bak-<date>; nothing is deleted (copy your settings, such as .env, back from there).",
                ExistingFolderChoice.MoveAside, Primary: true),
            new ChoiceDialog.Option<ExistingFolderChoice>("Abort installation", "Changes nothing on the server.", ExistingFolderChoice.Abort));
        Run.Busy = true;
        if (choice == ExistingFolderChoice.Abort) return false;
        await Task.Run(() => GitCloneInstaller.MoveAsideAsync(connection, directory, Run.Log));
        return true;
    }
}
