using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>Removes the CMS (AtomCMS or your own): Octane is the site again, as after the server installation.</summary>
public sealed class RemoveCmsStep : InstallStep
{
    private readonly CheckBox _deleteFiles = new() { Content = "Also delete the CMS' folder and its NGINX site file (cannot be undone)" };
    private readonly TextBlock _deleteWhat = Text("", 12, "Pro.Subtle");

    /// <summary>Set after a run, for the finished page.</summary>
    public string? RemovedName { get; private set; }
    public bool FilesDeleted { get; private set; }

    public override string Title => "Remove the CMS";
    public override string Caption => "Octane on / again";
    public override string InstallLabel => "Remove the CMS";
    public override string RerunLabel => "Set it back again";

    public RemoveCmsStep() : base(Icons.Puzzle,
        "Remove the CMS",
        "The hotel goes back to how the server installation set it up: Octane is the website on /, with its own login screen, and the CMS is no longer served.",
        [
            "Octane moves back to /: vite without --base, client-mode.json with /configuration/, its own login screen on again, and a rebuild.",
            $"NGINX: the hotel site serves Octane on / again (127.0.0.1:{HotelSite.Port}); the CMS' own NGINX site is disabled.",
            "Traefik: /ws and all of /api go to Polaris again, everything else to the hotel site.",
            "The CMS' files stay unless you tick the box below. Its database tables (such as AtomCMS' website_* tables) and users stay in the hotel database.",
            "Tests the site, Polaris' /api/health and the websocket through Traefik."
        ],
        "The hotel is briefly unavailable while Octane is rebuilt (about a minute).",
        [
            "Check the server",
            "Octane on /: configure and build",
            "NGINX and Traefik",
            "Disable the CMS site",
            "Test the site, /api and /ws"
        ])
    {
    }

    protected override Control BuildOptions()
    {
        var panel = new StackPanel { Spacing = 6, Margin = new Thickness(0, 8, 0, 0) };
        panel.Children.Add(_deleteFiles);
        panel.Children.Add(_deleteWhat);
        return panel;
    }

    // The CMS on the server: its NGINX site name and folder.
    private static (string SiteName, string Folder)? Cms(WebAccessSettings site) =>
        site.AtomCms ? (AtomCmsInstaller.SiteName, AtomCmsInstaller.Directory)
        : site.CustomCms is { } name && CustomCmsInstaller.NameProblem(name) is null ? (name, CustomCmsInstaller.Directory(name))
        : null;

    protected override async Task<bool> DetectCoreAsync(ServerConnection connection)
    {
        AtomCmsState state = await Task.Run(() => AtomCmsInstaller.InspectAsync(connection));
        if (state.Site is not { } site)
        {
            Detected.Show(ResultKind.Warning, "There is no website set up yet", "Run the Web access step first.");
            return false;
        }
        if (!site.HasCms)
        {
            _deleteWhat.Text = "";
            _deleteFiles.IsEnabled = false;
            Detected.Show(ResultKind.Success, "There is no CMS", $"Octane is the website of {site.Url} already. Running this step anyway sets Octane, NGINX and Traefik back.");
            return true;
        }
        _deleteFiles.IsEnabled = Cms(site) is not null;
        _deleteWhat.Text = Cms(site) is { } cms ? $"Deletes {cms.Folder} and {CmsSite.File(cms.SiteName)}." : "";
        Detected.Show(ResultKind.Info, $"{site.CmsName} is the website of {site.Url}",
            $"After this step Octane is the website on {site.Url}/ again, with its own login screen.");
        return false;
    }

    protected override async Task<StepOutcome> RunCoreAsync(ServerConnection connection, Window owner)
    {
        Run.Log("> Checking the server ...");
        AtomCmsState state = await Task.Run(() => AtomCmsInstaller.InspectAsync(connection));
        if (state.Site is not { } current) throw new ServerConnectionException("Run the Web access step first: there is no website to set back.");
        if (state.NodeVersion is null) throw new ServerConnectionException("Node.js is missing: run the Dev tools step first (Octane is rebuilt).");
        if (!state.OctaneBuilt) throw new ServerConnectionException("Octane is not built yet: run the Octane step first.");
        (string SiteName, string Folder)? cms = Cms(current);
        bool delete = _deleteFiles.IsChecked == true && cms is not null;
        WebAccessSettings site = current with { AtomCms = false, CustomCms = null, CmsPort = 0 };
        Run.Log(current.HasCms ? $"  {current.CmsName} is the website of {current.Url}: setting Octane back on /" : $"  No CMS on {current.Url}: setting Octane, NGINX and Traefik back anyway");
        Run.Done(current.CmsName ?? "no CMS");

        await Task.Run(() => OctaneInstaller.ConfigureAsync(connection, site, Run.Log, restoreLoginScreen: true));
        await Task.Run(() => OctaneInstaller.BuildAsync(connection, site, Run.Log));
        Run.Done(site.ClientUrl);

        // Traefik sends everything to the hotel site first: publishing checks Octane on / through Traefik, which would
        // still reach the CMS otherwise.
        await Task.Run(() => WebAccessInstaller.ConfigureRoutesAsync(connection, site, Run.Log));
        await Task.Run(() => OctaneInstaller.PublishAsync(connection, site, Run.Log));
        Run.Done("Octane on /");

        await Task.Run(() => CmsSite.RemoveAsync(connection, cms?.SiteName, delete ? cms?.Folder : null, Run.Log));
        Run.Done(delete ? "disabled and deleted" : "disabled, files kept");

        WebAccessResult result = await Task.Run(() => WebAccessInstaller.TestAsync(connection, site, Run.Log));
        Run.Done(result.ApiAnswered ? "OK" : "site OK, check /api");

        RemovedName = current.CmsName;
        FilesDeleted = delete;
        string files = cms is null ? "" : delete ? $" {cms.Value.Folder} is deleted." : $" Its files stay in {cms.Value.Folder}.";
        return await SucceededAsync($"Octane is the website of {site.Url} again",
            (current.HasCms ? $"{current.CmsName} is removed.{files} " : "") +
            "Octane has its own login screen again; Traefik and NGINX are as after the server installation. Install a CMS again with Addons → CMS.");
    }
}
