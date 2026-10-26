using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Controls.Primitives;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Input;
using Avalonia.Threading;
using AllInOneInstaller.Remote;
using AllInOneInstaller.Update;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>Main window, with the same sidebar/header/footer shell as the All-in-1 Converter.</summary>
public sealed class InstallerWindow : Window
{
    /// <summary>What a full server installation puts on the server.</summary>
    public static readonly (string Name, string Description, string Repository, string Icon, string Color)[] Components =
    [
        ("Polaris Emulator", "Java 25 game server with a MariaDB database", "duckietm/Polaris-Emulator", Icons.Server, "#4F5FE6"),
        ("Octane", "React browser client (navigator, catalog, chat ...)", "duckietm/Octane", Icons.Cube, "#8B5CF6"),
        ("Octane Renderer", "Draws rooms, avatars and furniture for Octane", "duckietm/Octane-Renderer", Icons.Star, "#0E9F9E")
    ];

    private readonly ContentControl _pageHost = new();
    private readonly ScrollViewer _pageScroll = new() { HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
    private readonly StackPanel _content = new() { Spacing = 18, Margin = new Thickness(32, 0, 32, 18) };
    private readonly TextBlock _title = Text("", 26, weight: FontWeight.SemiBold);
    private readonly TextBlock _subtitle = Text("", 13.5, "Pro.Muted");
    private readonly Border _statusPill = new() { CornerRadius = new CornerRadius(14), Padding = new Thickness(11, 5), VerticalAlignment = VerticalAlignment.Center };
    private readonly Avalonia.Controls.Shapes.Ellipse _statusDot = Dot();
    private readonly TextBlock _statusPillText = new() { FontSize = 12, FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _status = Text("", 12, "Pro.Muted");
    private readonly TextBlock _connectionFooter = Text("", 12, "Pro.Muted");
    private readonly List<Button> _navigationButtons = [];
    private Button? _dashboardNavigation;
    private Button? _installNavigation;
    private Button? _atomNavigation;
    private Button? _deployNavigation;
    private Button? _explorerNavigation;
    private Button? _sqlNavigation;
    private Button? _toolsNavigation;
    private Button? _settingsNavigation;
    private Button? _aboutNavigation;
    private readonly SettingsView _settings = new();
    private readonly ServerWizard _wizard;
    private readonly ServerWizard _atomWizard;
    private readonly ServerWizard _deployWizard;
    private readonly AssetExplorerView _explorer;
    private readonly SqlEditorView _sqlEditor;
    private readonly ToolsView _tools;
    private bool _toolsBusy;
    // The dashboard's components card, with the versions on the server and what the update check found.
    private readonly ContentControl _componentsHost = new();
    private IReadOnlyList<RepositoryVersion>? _versions;
    private ServerConnection? _versionsFor;
    private bool _loadingVersions;
    private string _statusMessage = "Ready.";

    // The login at startup, shared by every page until the program closes or the server goes away.
    private ServerConnection? _session;
    private LoginDialog.Prefill? _lastLogin;
    private bool _loginOpen;
    // The connection was lost: the login opens again as soon as nothing runs any more.
    private bool _loginPending;
    private readonly DispatcherTimer _watch = new() { Interval = TimeSpan.FromSeconds(3) };
    private ServerConnection? Session => _session is { IsConnected: true } session ? session : null;

    private ServerWizard[] Wizards => [_wizard, _atomWizard, _deployWizard];
    private bool AnyBusy => _toolsBusy || Wizards.Any(w => w.IsBusy);
    // The wizard on screen, whose status line the footer shows.
    private ServerWizard? CurrentWizard => _page switch { Page.Install => _wizard, Page.AtomCms => _atomWizard, Page.DeployAssets => _deployWizard, _ => null };

    public InstallerWindow()
    {
        ProfessionalTheme.Install(Application.Current!);
        Title = "All-in-1 Installer";
        Width = 1280;
        Height = 820;
        MinWidth = 1000;
        MinHeight = 680;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        RequestedThemeVariant = ThemeVariant.Default;
        this.Bind(BackgroundProperty, "Pro.Surface");

        _wizard = new ServerWizard(() => Session);
        var atomStep = new AtomCmsStep();
        _atomWizard = new ServerWizard(() => Session, [atomStep],
            (_, _, site, _, steps) => FinishedView.BuildAtomCms(site, atomStep.InstallationKey, atomStep.InstallationCompleted, steps),
            "Web installer", keyStep: false);
        var syncStep = new AssetSyncStep();
        var textsStep = new UiTextsStep();
        var emulatorAssetsStep = new EmulatorAssetsStep();
        _deployWizard = new ServerWizard(() => Session, [syncStep, textsStep, emulatorAssetsStep],
            (_, _, site, _, steps) => FinishedView.BuildDeploy(site, [syncStep.Summary, textsStep.Summary, emulatorAssetsStep.Summary], steps),
            "Assets on the server", keyStep: false);
        _explorer = new AssetExplorerView(() => Session, ShowDashboard);
        _sqlEditor = new SqlEditorView(() => Session, ShowDashboard);
        _tools = new ToolsView(() => Session, (busy, status) =>
        {
            _toolsBusy = busy;
            SetStatus(status);
        });
        _tools.MonitorRequested += ShowMonitor;
        _tools.TerminalRequested += ShowTerminal;
        _tools.BackRequested += ShowTools;
        _tools.LoginRequested += async () => await ShowLoginAsync();
        // A finished check (also after an update, which changes the versions) refreshes the dashboard's card.
        _tools.UpdatesChecked += async _ =>
        {
            RefreshComponents();
            await LoadVersionsAsync();
        };
        foreach (ServerWizard wizard in Wizards)
        {
            wizard.StateChanged += () =>
            {
                RefreshHeader();
                RefreshFooter();
            };
            wizard.Exited += ShowDashboard;
            wizard.LoginRequested += async () => await ShowLoginAsync();
        }
        Content = BuildLayout();
        Closing += (_, e) =>
        {
            if (!AnyBusy) return;
            e.Cancel = true;
            SetStatus("Wait until the running step has finished before closing.");
        };
        Closed += async (_, _) =>
        {
            _watch.Stop();
            await _sqlEditor.CloseSessionAsync();
            if (_session is not null) await _session.DisposeAsync();
            _session = null;
        };
        // The update check first: when the installer replaces itself there is nothing to log in to.
        Opened += async (_, _) =>
        {
            if (await CheckForUpdateAsync()) return;
            await ShowLoginAsync();
            _watch.Start();
        };
        _watch.Tick += async (_, _) => await WatchSessionAsync();
        ShowDashboard();
    }

    /// <summary>Opens the login (at startup, from a Log in button, or after a lost connection) and makes it the session.</summary>
    private async Task ShowLoginAsync(string? notice = null)
    {
        if (_loginOpen || AnyBusy || Session is not null) return;
        _loginOpen = true;
        RefreshHeader();
        try
        {
            ServerConnection? connection = await LoginDialog.ShowAsync(this, _lastLogin, notice);
            if (connection is null)
            {
                SetStatus("Not connected. Log in with the button at the top right.");
                return;
            }
            ServerConnection? old = _session;
            _session = connection;
            ServerLogin login = connection.Login;
            string host = login.Port == 22 ? login.Host : login.Host.Contains(':') ? $"[{login.Host}]:{login.Port}" : $"{login.Host}:{login.Port}";
            _lastLogin = new LoginDialog.Prefill(host, login.User, login.UsesKey, login.PrivateKeys?.FirstOrDefault());
            if (old is not null) await old.DisposeAsync();
            SetStatus($"Connected to {login.Host} as {(connection.LoginUser == "root" ? "root" : $"{connection.LoginUser} (root through sudo)")}.");
            await SessionChangedAsync();
        }
        finally
        {
            _loginOpen = false;
            RefreshHeader();
            RefreshFooter();
        }
    }

    // Notices a connection the server dropped, and opens the login again once nothing runs any more.
    private async Task WatchSessionAsync()
    {
        if (_session is { IsConnected: false } lost)
        {
            _session = null;
            try { await lost.DisposeAsync(); } catch (Exception) { }
            SetStatus($"The connection to {lost.Login.Host} was lost.");
            _loginPending = true;
            await SessionChangedAsync();
        }
        if (_loginPending && !AnyBusy && !_loginOpen)
        {
            _loginPending = false;
            await ShowLoginAsync($"The connection to {_lastLogin?.Host ?? "the server"} was lost");
        }
    }

    // Shows the page on screen again, so it follows the new login (or the lack of one).
    private async Task SessionChangedAsync()
    {
        if (Session is null) await _sqlEditor.CloseSessionAsync();
        _tools.Refresh();
        switch (_page)
        {
            case Page.Install: ShowInstallNewServer(); break;
            case Page.AtomCms: ShowAtomCms(); break;
            case Page.DeployAssets: ShowDeployAssets(); break;
            case Page.AssetExplorer: ShowAssetExplorer(); break;
            case Page.SqlEditor: ShowSqlEditor(); break;
            case Page.Tools or Page.ServerStatus or Page.EmulatorMonitor or Page.Terminal: ShowTools(); break;
            case Page.Dashboard: ShowDashboard(); break;
            default:
                RefreshHeader();
                RefreshFooter();
                break;
        }
    }

    private void SetStatus(string message)
    {
        _statusMessage = message;
        RefreshFooter();
    }

    /// <summary>
    /// Asks GitHub at startup whether a newer version of the installer itself was released, and offers to
    /// replace this program with it. Only the published single-file program updates itself; a repository
    /// without releases, or no internet, means nothing is shown.
    /// </summary>
    /// <returns>True when the installer restarts as the new version.</returns>
    private async Task<bool> CheckForUpdateAsync()
    {
        AppUpdate.CleanUp();
        if (await AppUpdate.CheckAsync() is not { } update) return false;
        SetStatus($"Version {update.Version} of the installer is available.");
        if (!await UpdateDialog.ShowAsync(this, update)) return false;
        AppUpdate.Restart();
        (Application.Current?.ApplicationLifetime as IClassicDesktopStyleApplicationLifetime)?.Shutdown();
        return true;
    }

    private Control BuildLayout()
    {
        var root = new Grid { ColumnDefinitions = new ColumnDefinitions("236,*") };
        root.Children.Add(BuildSidebar());

        var main = new Grid { RowDefinitions = new RowDefinitions("Auto,*,Auto") };
        Grid.SetColumn(main, 1);

        var header = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), Margin = new Thickness(32, 26, 32, 20) };
        var heading = new StackPanel { Spacing = 4 };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);
        header.Children.Add(heading);
        var pill = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7 };
        pill.Children.Add(_statusDot);
        pill.Children.Add(_statusPillText);
        _statusPill.Child = pill;
        // Not connected: the pill is the way to log in.
        _statusPill.PointerPressed += async (_, _) => await ShowLoginAsync();
        Grid.SetColumn(_statusPill, 1);
        header.Children.Add(_statusPill);
        main.Children.Add(header);

        _pageScroll.Content = _content;
        Grid.SetRow(_pageHost, 1);
        main.Children.Add(_pageHost);

        var footer = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), Margin = new Thickness(32, 9) };
        _status.TextTrimming = TextTrimming.CharacterEllipsis;
        _status.TextWrapping = TextWrapping.NoWrap;
        footer.Children.Add(_status);
        _connectionFooter.TextWrapping = TextWrapping.NoWrap;
        _connectionFooter.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_connectionFooter, 1);
        footer.Children.Add(_connectionFooter);
        var footerBar = new Border { BorderThickness = new Thickness(0, 1, 0, 0), Child = footer }
            .Bind(Border.BorderBrushProperty, "Pro.CardBorder")
            .Bind(Border.BackgroundProperty, "Pro.Card");
        Grid.SetRow(footerBar, 2);
        main.Children.Add(footerBar);

        root.Children.Add(main);
        RefreshFooter();
        return root;
    }

    private Control BuildSidebar()
    {
        var sidebar = new Grid { RowDefinitions = new RowDefinitions("Auto,*,Auto") };

        var brand = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 11, Margin = new Thickness(6, 0, 0, 26) };
        var logoIcon = Icon(Icons.Server, 19);
        logoIcon.Foreground = Brushes.White;
        brand.Children.Add(new Border
        {
            Width = 36,
            Height = 36,
            CornerRadius = new CornerRadius(10),
            Background = new LinearGradientBrush
            {
                StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative),
                EndPoint = new RelativePoint(1, 1, RelativeUnit.Relative),
                GradientStops = { new GradientStop(Color.Parse("#6D7BFF"), 0), new GradientStop(Color.Parse("#4352D4"), 1) }
            },
            Child = logoIcon
        });
        var brandText = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        brandText.Children.Add(new TextBlock { Text = "All-in-1 Installer", Foreground = Brushes.White, FontSize = 15, FontWeight = FontWeight.SemiBold });
        brandText.Children.Add(new TextBlock { Text = "Hotel server setup", Foreground = Solid(SidebarMuted), FontSize = 11.5 });
        brand.Children.Add(brandText);
        sidebar.Children.Add(brand);

        var nav = new StackPanel { Spacing = 3 };
        _dashboardNavigation = NavButton("Dashboard", Icons.Home, ShowDashboard);
        nav.Children.Add(_dashboardNavigation);
        nav.Children.Add(SidebarLabel("SERVER"));
        _installNavigation = NavButton("Install New Server", Icons.ServerPlus, ShowInstallNewServer);
        nav.Children.Add(_installNavigation);
        nav.Children.Add(SidebarLabel("ADDONS"));
        _atomNavigation = NavButton("AtomCMS", Icons.Puzzle, ShowAtomCms);
        nav.Children.Add(_atomNavigation);
        _deployNavigation = NavButton("Deploy Assets", Icons.Download, ShowDeployAssets);
        nav.Children.Add(_deployNavigation);
        _explorerNavigation = NavButton("Asset Explorer", Icons.FolderSync, ShowAssetExplorer);
        nav.Children.Add(_explorerNavigation);
        _sqlNavigation = NavButton("SQL Editor", Icons.Database, ShowSqlEditor);
        nav.Children.Add(_sqlNavigation);
        nav.Children.Add(SidebarLabel("TOOLS"));
        _toolsNavigation = NavButton("Tools", Icons.Wrench, ShowTools);
        nav.Children.Add(_toolsNavigation);
        nav.Children.Add(SidebarLabel("GENERAL"));
        _settingsNavigation = NavButton("Settings", Icons.Cog, ShowSettings);
        nav.Children.Add(_settingsNavigation);
        _aboutNavigation = NavButton("About", Icons.Info, ShowAbout);
        nav.Children.Add(_aboutNavigation);
        Grid.SetRow(nav, 1);
        sidebar.Children.Add(nav);

        var footer = new StackPanel { Spacing = 6 };
        footer.Children.Add(new Border { Height = 1, Background = Solid(SidebarHover), Margin = new Thickness(4, 0, 4, 6) });
        footer.Children.Add(new TextBlock
        {
            Text = "Targets Ubuntu Server and Debian",
            Foreground = Solid(SidebarMuted),
            FontSize = 11.5,
            Margin = new Thickness(12, 0),
            TextWrapping = TextWrapping.Wrap
        });
        Grid.SetRow(footer, 2);
        sidebar.Children.Add(footer);

        return new Border { Background = Solid(Sidebar), Padding = new Thickness(14, 22), Child = sidebar };
    }

    private static TextBlock SidebarLabel(string text) => new()
    {
        Text = text,
        Foreground = Solid(SidebarMuted),
        FontSize = 10.5,
        FontWeight = FontWeight.SemiBold,
        LetterSpacing = 1,
        Margin = new Thickness(12, 18, 0, 6)
    };

    private Button NavButton(string label, string icon, Action action)
    {
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        content.Children.Add(Icon(icon, 17));
        content.Children.Add(new TextBlock { Text = label, FontSize = 13.5, VerticalAlignment = VerticalAlignment.Center });
        var button = new Button
        {
            Content = content,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            Padding = new Thickness(12, 9),
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(8),
            Classes = { "nav" }
        };
        button.Click += (_, _) =>
        {
            if (AnyBusy) return;
            action();
        };
        _navigationButtons.Add(button);
        return button;
    }

    private void ActivateNavigation(Button? selected)
    {
        foreach (Button button in _navigationButtons)
        {
            bool isSelected = button == selected;
            button.Classes.Set("selected", isSelected);
            if (button.Content is StackPanel { Children: [PathIcon icon, TextBlock text] })
            {
                if (isSelected) icon.Foreground = Solid(SidebarAccent);
                else icon.ClearValue(ForegroundProperty);
                text.FontWeight = isSelected ? FontWeight.SemiBold : FontWeight.Normal;
            }
        }
    }

    private void ShowScrollPage(params Control[] sections)
    {
        _content.Children.Clear();
        foreach (Control section in sections) _content.Children.Add(section);
        _pageHost.Content = _pageScroll;
        _pageScroll.Offset = default;
    }

    private enum Page { Dashboard, Install, AtomCms, DeployAssets, AssetExplorer, SqlEditor, Tools, ServerStatus, EmulatorMonitor, Terminal, Settings, About }
    private Page _page;

    private void RefreshHeader()
    {
        ServerConnection? session = Session;
        string host = session?.Login.Host ?? "the server";
        (_title.Text, _subtitle.Text) = _page switch
        {
            Page.Install => ("Install New Server", session is null
                ? "Log in to the Ubuntu / Debian server that will run the hotel."
                : $"The full hotel stack on {host}: an SSH key for root first, then every part of the hotel."),
            Page.AtomCms => ("AtomCMS", "Addon: AtomCMS as the hotel's website, Octane on /client."),
            Page.AssetExplorer => ("Asset Explorer", session is null
                ? "Addon: manage the files in /var/www/gamedata, with this computer next to it."
                : $"This computer on the left, {host}:{GamedataFiles.Root} on the right."),
            Page.SqlEditor => ("SQL Editor", session is null
                ? "Addon: a database client like HeidiSQL, through the SSH login (no open MariaDB port needed)."
                : $"The databases of {host}: browse and edit tables, run queries."),
            Page.DeployAssets => ("Deploy Assets", "Addon: copy the hotel's assets, the client's UI texts and the emulator's images to /var/www/gamedata on the server."),
            Page.Tools => ("Tools", "Restart services, back up and import the database, update, and move your settings."),
            Page.ServerStatus => ("Server status", $"Live figures of {host}, every 2 seconds."),
            Page.Terminal => ("SSH terminal", $"A shell on {host}, logged in as {session?.Login.User ?? "root"}."),
            Page.EmulatorMonitor => ("Emulator & wired", $"The emulator on {host}: CPU per thread, the wired engine and slow wired rooms."),
            Page.About => ("About", "All-in-1 Installer"),
            Page.Settings => ("Settings", "Default server and SSH key, your own SSH keys, and the All-in-1 downloader."),
            _ => ("Dashboard", "Set up a complete hotel server over SSH.")
        };

        (string text, string back, string fore) = session is not null
            ? (session.LoginUser == "root" ? $"Root on {host}" : $"{session.LoginUser} (sudo) on {host}", "Pro.SuccessBack", "Pro.SuccessText")
            : _loginOpen
                ? ("Logging in", "Pro.InfoBack", "Pro.InfoText")
                : ("Not connected · Log in", "Pro.WarningBack", "Pro.WarningText");
        _statusPillText.Text = text;
        _statusPillText.Bind(TextBlock.ForegroundProperty, fore);
        _statusDot.Bind(Avalonia.Controls.Shapes.Shape.FillProperty, fore);
        _statusPill.Bind(Border.BackgroundProperty, back);
        _statusPill.Cursor = session is null ? new Cursor(StandardCursorType.Hand) : Cursor.Default;
        ToolTip.SetTip(_statusPill, session is null ? "Log in to your server" : null);
    }

    private void RefreshFooter()
    {
        ServerConnection? connection = Session;
        _connectionFooter.Text = connection is null
            ? "No server connected"
            : $"{connection.LoginUser}@{connection.Login.Host}:{connection.Login.Port}  ·  {connection.Os?.PrettyName}";
        _status.Text = CurrentWizard?.StatusMessage is { } wizardStatus && wizardStatus != "Ready." ? wizardStatus : _statusMessage;
    }

    private void ShowDashboard()
    {
        _page = Page.Dashboard;
        ActivateNavigation(_dashboardNavigation);
        var tiles = new List<Control>();
        if (Session is null)
            tiles.Add(Tile("Log in", "Log in to your server: with a password or your SSH key. The login is used for everything below and stays open until you close the program.",
                Icons.Account, Color.Parse("#16A34A"), async () => await ShowLoginAsync()));
        tiles.AddRange(
        [
            Tile("Install New Server", "Install the full hotel stack on the server you are logged in to: a fresh Ubuntu Server / Debian machine.",
                Icons.ServerPlus, Brand, ShowInstallNewServer),
            _componentsHost,
            Text("ADDONS", 11, "Pro.Muted", FontWeight.SemiBold),
            TileGrid(
                SmallTile("AtomCMS", "AtomCMS as the hotel's website; Octane moves to /client.",
                    Icons.Puzzle, Color.Parse("#E8590C"), ShowAtomCms),
                SmallTile("Deploy Assets", "The All-in-1 downloader's assets and the UI texts to /var/www/gamedata.",
                    Icons.Download, Color.Parse("#8B5CF6"), ShowDeployAssets),
                SmallTile("Asset Explorer", "Two panes: this computer and /var/www/gamedata. Upload, download, rename.",
                    Icons.FolderSync, Color.Parse("#2563EB"), ShowAssetExplorer),
                SmallTile("SQL Editor", "Like HeidiSQL: browse and edit tables, run queries, export to CSV.",
                    Icons.Database, Color.Parse("#0891B2"), ShowSqlEditor)),
            Text("TOOLS", 11, "Pro.Muted", FontWeight.SemiBold),
            TileGrid(
                SmallTile("Tools", "Restarts, database backup and import, updates, settings backup.",
                    Icons.Wrench, Color.Parse("#0E9F9E"), ShowTools))
        ]);
        _componentsHost.Content = BuildComponentsCard();
        ShowScrollPage([.. tiles]);
        RefreshHeader();
        RefreshFooter();
        if (Session is { } session && !ReferenceEquals(_versionsFor, session)) _ = LoadVersionsAsync();
    }

    private void ShowInstallNewServer() => ShowWizard(Page.Install, _installNavigation, _wizard);
    private void ShowAtomCms() => ShowWizard(Page.AtomCms, _atomNavigation, _atomWizard);
    private void ShowDeployAssets() => ShowWizard(Page.DeployAssets, _deployNavigation, _deployWizard);

    // The wizard asks for a login when there is none, starts for a new login, or shows the step where it was.
    private async void ShowWizard(Page page, Button? navigation, ServerWizard wizard)
    {
        _page = page;
        ActivateNavigation(navigation);
        ShowScrollPage(wizard.View);
        RefreshHeader();
        RefreshFooter();
        try
        {
            await wizard.OpenAsync();
            wizard.FocusCurrentStep();
        }
        catch (Exception ex)
        {
            SetStatus($"Checking the server failed: {(ex is ServerConnectionException ? ex.Message : $"{ex.GetType().Name}: {ex.Message}")}");
        }
    }

    private void ShowTools()
    {
        _page = Page.Tools;
        ActivateNavigation(_toolsNavigation);
        _tools.Refresh();
        ShowScrollPage(_tools.Workspace, _tools.Settings);
        RefreshHeader();
        RefreshFooter();
    }

    // Only the dashboard; Back (or Tools in the sidebar) returns to the tiles.
    private void ShowMonitor(ToolsView.Monitor monitor)
    {
        _page = monitor == ToolsView.Monitor.Server ? Page.ServerStatus : Page.EmulatorMonitor;
        ActivateNavigation(_toolsNavigation);
        ShowScrollPage(_tools.MonitorPage(monitor));
        RefreshHeader();
        RefreshFooter();
    }

    // The terminal fills the page (no scrolling around it); Back or Tools returns to the tiles.
    private void ShowTerminal()
    {
        _page = Page.Terminal;
        ActivateNavigation(_toolsNavigation);
        _content.Children.Clear();
        _pageHost.Content = _tools.TerminalPage;
        RefreshHeader();
        RefreshFooter();
    }

    private void ShowAssetExplorer() => ShowWorkspace(Page.AssetExplorer, _explorerNavigation, _explorer,
        "The Asset Explorer works on /var/www/gamedata of the server you are logged in to.");

    private void ShowSqlEditor() => ShowWorkspace(Page.SqlEditor, _sqlNavigation, _sqlEditor,
        "The SQL Editor reaches MariaDB through the login to the server.");

    // A page that fills the window (no scrolling around it) while logged in; otherwise a Log in card.
    private void ShowWorkspace(Page page, Button? navigation, Control workspace, string needsLogin)
    {
        _page = page;
        ActivateNavigation(navigation);
        if (Session is null)
        {
            ShowScrollPage(NotConnectedCard(needsLogin));
        }
        else
        {
            _content.Children.Clear();
            // Attached again, so it notices a new login.
            _pageHost.Content = null;
            _pageHost.Content = workspace;
        }
        RefreshHeader();
        RefreshFooter();
    }

    private Control NotConnectedCard(string message)
    {
        var panel = new StackPanel { Spacing = 10 };
        panel.Children.Add(Text("Not connected", 17, weight: FontWeight.SemiBold));
        panel.Children.Add(Text(message + " Log in first: the login stays open until you close the program.", 13, "Pro.Muted"));
        var login = new Button { Content = "Log in", Padding = new Thickness(22, 9), Classes = { "primary" }, HorizontalAlignment = HorizontalAlignment.Left };
        login.Click += async (_, _) => await ShowLoginAsync();
        panel.Children.Add(login);
        return Card(panel, new Thickness(28, 24));
    }

    private void ShowSettings()
    {
        _page = Page.Settings;
        ActivateNavigation(_settingsNavigation);
        _settings.Refresh();
        ShowScrollPage(_settings.View);
        RefreshHeader();
    }

    /// <summary>Who made what, in the order they joined in.</summary>
    private static readonly (string Who, string What)[] Credits =
    [
        ("DuckieTM", "The installer, and the All-in-1 Converter this look and feel comes from."),
        ("Life", "The branch choice (main / dev) for the clone steps and in Settings, the update check for the hotel's " +
                 "repositories, and the installer's own update at startup.")
    ];

    private void ShowAbout()
    {
        _page = Page.About;
        ActivateNavigation(_aboutNavigation);
        var panel = new StackPanel { Spacing = 8 };
        panel.Children.Add(Text("All-in-1 Installer", 16, weight: FontWeight.SemiBold));
        panel.Children.Add(Text($"Version {AppUpdate.Current}", 12.5, "Pro.Subtle"));
        panel.Children.Add(Text("Installs a full hotel server (Polaris Emulator, Octane and Octane Renderer) on an Ubuntu Server or Debian machine over SSH.", 13, "Pro.Muted"));

        TextBlock heading = Text("CREDITS", 11, "Pro.Muted", FontWeight.SemiBold);
        heading.Margin = new Thickness(0, 12, 0, 0);
        panel.Children.Add(heading);
        foreach ((string who, string what) in Credits)
        {
            var line = new Grid { ColumnDefinitions = new ColumnDefinitions("110,*"), ColumnSpacing = 12 };
            line.Children.Add(Text(who, 12.5, weight: FontWeight.SemiBold));
            TextBlock contribution = Text(what, 12.5, "Pro.Muted");
            Grid.SetColumn(contribution, 1);
            line.Children.Add(contribution);
            panel.Children.Add(line);
        }
        ShowScrollPage(Card(panel));
        RefreshHeader();
    }

    private Control Tile(string title, string description, string iconPath, Color color, Action open)
    {
        var icon = Icon(iconPath, 26);
        icon.Foreground = Solid(color);
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto"), ColumnSpacing = 18 };
        grid.Children.Add(new Border
        {
            Width = 52,
            Height = 52,
            CornerRadius = new CornerRadius(12),
            Background = Solid(Color.FromArgb(0x26, color.R, color.G, color.B)),
            VerticalAlignment = VerticalAlignment.Center,
            Child = icon
        });
        var text = new StackPanel { Spacing = 3, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(Text(title, 17, weight: FontWeight.SemiBold));
        text.Children.Add(Text(description, 12.5, "Pro.Muted"));
        Grid.SetColumn(text, 1);
        grid.Children.Add(text);
        var chevron = Icon(Icons.ChevronRight, 22).Bind(PathIcon.ForegroundProperty, "Pro.Subtle");
        chevron.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(chevron, 2);
        grid.Children.Add(chevron);

        var tile = new Button
        {
            Content = grid,
            Padding = new Thickness(22, 20),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            CornerRadius = new CornerRadius(12),
            BorderThickness = new Thickness(1),
            Classes = { "tile" }
        };
        tile.Click += (_, _) =>
        {
            if (AnyBusy) return;
            open();
        };
        return tile;
    }

    // Small tiles side by side: as many columns of at least 250 px as fit, at most four, all the same width. Three
    // columns become two, so the four addons are a row of four or two rows of two.
    private static Control TileGrid(params Control[] tiles)
    {
        // The negative margin takes back the gap after the last column and row, so the edges line up with the cards.
        var grid = new Avalonia.Controls.Primitives.UniformGrid { Columns = Math.Min(4, tiles.Length), Margin = new Thickness(0, 0, -12, -12) };
        foreach (Control tile in tiles) grid.Children.Add(tile);
        // Always the column count of the width, also for one tile (Tools), so it is as wide as an addon tile above it.
        grid.SizeChanged += (_, e) => grid.Columns = Math.Clamp((int)(e.NewSize.Width / 250), 1, 4) is var columns && columns == 3 ? 2 : columns;
        return grid;
    }

    private Control SmallTile(string title, string description, string iconPath, Color color, Action open)
    {
        var icon = Icon(iconPath, 20);
        icon.Foreground = Solid(color);
        var panel = new StackPanel { Spacing = 10 };
        var top = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto"), ColumnSpacing = 12 };
        top.Children.Add(new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(10),
            Background = Solid(Color.FromArgb(0x26, color.R, color.G, color.B)),
            Child = icon
        });
        TextBlock name = Text(title, 14.5, weight: FontWeight.SemiBold);
        name.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(name, 1);
        top.Children.Add(name);
        var chevron = Icon(Icons.ChevronRight, 18).Bind(PathIcon.ForegroundProperty, "Pro.Subtle");
        chevron.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(chevron, 2);
        top.Children.Add(chevron);
        panel.Children.Add(top);
        TextBlock text = Text(description, 12, "Pro.Muted");
        text.TextWrapping = TextWrapping.Wrap;
        panel.Children.Add(text);

        var tile = new Button
        {
            Content = panel,
            Padding = new Thickness(16, 14),
            Margin = new Thickness(0, 0, 12, 12),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Top,
            CornerRadius = new CornerRadius(12),
            BorderThickness = new Thickness(1),
            Classes = { "tile" }
        };
        tile.Click += (_, _) =>
        {
            if (AnyBusy) return;
            open();
        };
        return tile;
    }

    // The rows of the dashboard card: the full installation, plus AtomCMS once it is installed.
    private static readonly (string Name, string Description, string Repository, string Icon, string Color, string Directory, ToolsView.Component Update)[] Rows =
    [
        (Components[0].Name, Components[0].Description, Components[0].Repository, Components[0].Icon, Components[0].Color, EmulatorInstaller.Repository, ToolsView.Component.Emulator),
        (Components[1].Name, Components[1].Description, Components[1].Repository, Components[1].Icon, Components[1].Color, OctaneInstaller.Octane, ToolsView.Component.Octane),
        (Components[2].Name, Components[2].Description, Components[2].Repository, Components[2].Icon, Components[2].Color, OctaneInstaller.Renderer, ToolsView.Component.Octane),
        ("AtomCMS", "The hotel's website (addon), Octane on /client", "ObjectRetros/atomcms", Icons.Puzzle, "#E8590C", AtomCmsInstaller.Directory, ToolsView.Component.AtomCms)
    ];

    // Loads the installed versions (no network) once per login and after every update check.
    private async Task LoadVersionsAsync()
    {
        if (Session is not { } connection || _loadingVersions) return;
        _loadingVersions = true;
        try
        {
            _versions = await Task.Run(() => ServerStatus.VersionsAsync(connection));
            _versionsFor = connection;
        }
        catch (Exception ex)
        {
            _versions = null;
            _versionsFor = connection;
            SetStatus($"Reading the installed versions failed: {ex.Message}");
        }
        finally
        {
            _loadingVersions = false;
            RefreshComponents();
        }
    }

    private void RefreshComponents()
    {
        if (_page == Page.Dashboard) _componentsHost.Content = BuildComponentsCard();
    }

    // Shows the Tools page and runs the update there, so its question and progress are on screen.
    private async Task UpdateComponentAsync(ToolsView.Component component)
    {
        if (AnyBusy || Session is null) return;
        ShowTools();
        await Dispatcher.UIThread.InvokeAsync(() => { }, DispatcherPriority.Loaded);
        await _tools.UpdateAsync(component);
    }

    private Control BuildComponentsCard()
    {
        ServerConnection? session = Session;
        IReadOnlyList<RepositoryVersion>? versions = ReferenceEquals(_versionsFor, session) ? _versions : null;
        IReadOnlyList<RepositoryUpdate>? updates = session is null ? null : _tools.LastUpdates(session);

        var list = new StackPanel { Spacing = 2 };
        var top = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), Margin = new Thickness(12, 8, 12, 10) };
        var heading = new StackPanel { Spacing = 2 };
        heading.Children.Add(Text("Full server installation", 15, weight: FontWeight.SemiBold));
        heading.Children.Add(Text(session is null ? "Components the installer sets up. Log in to see the installed versions and updates."
            : updates is null ? $"The versions on {session.Login.Host}; checking GitHub for updates ..."
            : $"The versions on {session.Login.Host}, compared with GitHub (the branches chosen in Settings).", 12, "Pro.Muted"));
        top.Children.Add(heading);
        if (session is not null && updates is not null)
        {
            var again = new Button { Content = "Check again", Padding = new Thickness(12, 5), FontSize = 12, Classes = { "secondary" }, VerticalAlignment = VerticalAlignment.Center };
            again.Click += async (_, _) =>
            {
                if (AnyBusy) return;
                again.IsEnabled = false;
                again.Content = "Checking ...";
                await _tools.CheckUpdatesAgainAsync();
            };
            Grid.SetColumn(again, 1);
            top.Children.Add(again);
        }
        list.Children.Add(top);

        foreach (var component in Rows)
        {
            RepositoryVersion? version = versions?.FirstOrDefault(v => v.Directory == component.Directory);
            // AtomCMS is an addon: listed once it is installed.
            if (component.Update == ToolsView.Component.AtomCms && version is null) continue;
            RepositoryUpdate? update = updates?.FirstOrDefault(u => u.Directory == component.Directory);

            Color color = Color.Parse(component.Color);
            var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto"), ColumnSpacing = 14, Margin = new Thickness(12, 8) };
            var icon = Icon(component.Icon, 17);
            icon.Foreground = Solid(color);
            row.Children.Add(new Border
            {
                Width = 34,
                Height = 34,
                CornerRadius = new CornerRadius(9),
                Background = Solid(Color.FromArgb(0x26, color.R, color.G, color.B)),
                Child = icon
            });
            var text = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
            text.Children.Add(Text(component.Name, 13.5, weight: FontWeight.SemiBold));
            text.Children.Add(Text($"{component.Description}  ·  github.com/{component.Repository}", 12, "Pro.Muted"));
            if (version is not null)
            {
                string installed = string.Join("  ·  ", new[]
                {
                    version.Build,
                    version.Branch is null ? null : $"{version.Branch} @ {version.Commit}",
                    version.Date
                }.Where(p => p is not null));
                TextBlock line = Text(installed, 11.5, "Pro.Subtle");
                line.FontFamily = Mono;
                text.Children.Add(line);
            }
            Grid.SetColumn(text, 1);
            row.Children.Add(text);

            var state = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, VerticalAlignment = VerticalAlignment.Center };
            if (session is null)
                state.Children.Add(Chip("INCLUDED", "Pro.SuccessBack", "Pro.SuccessText"));
            else if (versions is null)
                state.Children.Add(Chip("READING ...", "Pro.InfoBack", "Pro.InfoText"));
            else if (version is null)
                state.Children.Add(Chip("NOT INSTALLED", "Pro.Hover", "Pro.Muted"));
            else if (updates is null)
                state.Children.Add(Chip("CHECKING GITHUB ...", "Pro.InfoBack", "Pro.InfoText"));
            else if (update is { HasUpdate: true } or { SwitchesBranch: true })
            {
                Border chip = Chip(update.HasUpdate ? $"{update.Behind} NEW COMMIT{(update.Behind == 1 ? "" : "S")}" : $"TO {update.Target}".ToUpperInvariant(),
                    "Pro.WarningBack", "Pro.WarningText");
                ToolTip.SetTip(chip, (update.SwitchesBranch ? $"Updating switches {update.Branch} to {update.Target}. " : "") +
                                     (update.Newest is null ? "" : $"Newest on GitHub: {update.Newest}"));
                state.Children.Add(chip);
                var button = new Button { Content = "Update", Padding = new Thickness(16, 6), FontSize = 12.5, Classes = { "primary" } };
                // Octane and its renderer are built together, so both rows run the same update.
                if (component.Update == ToolsView.Component.Octane) ToolTip.SetTip(button, "Updates Octane-Renderer and Octane together, then builds the client.");
                button.Click += async (_, _) => await UpdateComponentAsync(component.Update);
                state.Children.Add(button);
            }
            else if (update is not null)
                state.Children.Add(Chip("UP TO DATE", "Pro.SuccessBack", "Pro.SuccessText"));
            else
                state.Children.Add(Chip("NOT CHECKED", "Pro.Hover", "Pro.Muted"));
            Grid.SetColumn(state, 2);
            row.Children.Add(state);
            list.Children.Add(row);
        }
        return Card(list, new Thickness(12));
    }
}
