using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Platform.Storage;
using AllInOneInstaller.Configuration;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>Settings: the servers and default SSH key for the login, and importing your own SSH keys.</summary>
public sealed class SettingsView
{
    private sealed record KeyItem(string? Path)
    {
        public override string ToString() => Path is null ? "(no default key)" :
            $"{System.IO.Path.GetFileName(Path)}   (keys/{System.IO.Path.GetFileName(System.IO.Path.GetDirectoryName(Path))})";
    }

    // The saved servers: one row each (default choice, address, Remove), and a box to add one.
    private readonly StackPanel _serverList = new() { Spacing = 6 };
    private readonly TextBox _newServer = new() { MinWidth = 380, PlaceholderText = "192.168.1.10 or hotel.example.com (add :2222 for another SSH port)" };
    private bool _refreshing;
    private readonly ComboBox _defaultKey = new() { MinWidth = 380 };
    private readonly ResultBanner _defaultsResult = new();
    private readonly TextBox _importFor = new() { MinWidth = 260, PlaceholderText = "server, e.g. 203.0.113.10" };
    private readonly TextBox _paste = new()
    {
        AcceptsReturn = true,
        TextWrapping = TextWrapping.Wrap,
        Height = 130,
        FontFamily = Mono,
        FontSize = 12,
        PlaceholderText = "-----BEGIN OPENSSH PRIVATE KEY----- ...   or a public key: ssh-ed25519 AAAA... you@computer"
    };
    private readonly ResultBanner _importResult = new();
    private readonly StackPanel _keyList = new() { Spacing = 6 };
    // One branch list per repository the clone steps use, in the order of the dashboard's component list.
    private readonly ComboBox[] _branches = InstallerWindow.Components
        .Select(_ => new ComboBox { MinWidth = 380, ItemsSource = InstallerSettings.BranchChoices }).ToArray();
    private readonly ResultBanner _branchesResult = new();

    public Control View { get; }

    /// <summary>"Restart now" after changing the look: the window closes and the installer starts again.</summary>
    public event Action? RestartRequested;

    private readonly RadioButton _hotelLook = new() { GroupName = "look", Content = "Hotel: the look of a Habbo hotel (blue, yellow, pixel titles, a hotel view on the dashboard)" };
    private readonly RadioButton _professionalLook = new() { GroupName = "look", Content = "Professional: the calm look of the All-in-1 Converter (indigo, soft cards)" };
    private readonly ResultBanner _lookResult = new();
    private readonly Button _restart = new() { Content = "Restart now", Padding = new Thickness(18, 9), Classes = { "primary" }, IsVisible = false };

    // Server layout: one box per value, in the order of the card.
    private readonly TextBox _emulatorPath = LayoutBox("/var/www/emulator");
    // The emulator's account: the server's users when logged in, and "Create a new user" at the bottom.
    private readonly ComboBox _emulatorAccount = new() { MinWidth = 380 };
    private string _account = "emulator";
    private List<ServerUser>? _users;
    private ServerConnection? _usersFor;
    private bool _settingAccounts;
    private readonly Func<ServerConnection?> _connection;

    // ToString is what the list shows; no name is the "Create a new user" entry.
    private sealed record AccountItem(string? Name, string Caption)
    {
        public override string ToString() => Name is null ? Caption : $"{Name}   ({Caption})";
    }
    private readonly TextBox _emulatorLogs = LayoutBox("/var/log/emu");
    private readonly TextBox _octanePath = LayoutBox("/var/www/Octane");
    private readonly TextBox _rendererPath = LayoutBox("/var/www/Octane-Renderer");
    private readonly TextBox _gamedataPath = LayoutBox("/var/www/gamedata");
    private readonly TextBox _atomPath = LayoutBox("/var/www/atomcms");
    private readonly ComboBox _atomInstalled = new()
    {
        MinWidth = 380,
        ItemsSource = new[] { "Detect: look on the server", "Installed", "Not installed" }
    };
    private readonly TextBox _backupsPath = LayoutBox("/var/backups/all-in-1");
    private readonly TextBox _database = LayoutBox("habbo");
    private readonly ResultBanner _rootWarning = new();
    private readonly ResultBanner _layoutResult = new();
    private readonly Button _layoutRestart = new() { Content = "Restart now", Padding = new Thickness(18, 9), Classes = { "primary" }, IsVisible = false };

    /// <param name="connection">The login at startup, for the list of the server's users.</param>
    public SettingsView(Func<ServerConnection?> connection)
    {
        _connection = connection;
        _emulatorAccount.SelectionChanged += async (_, _) => await AccountChosenAsync();
        var page = new StackPanel { Spacing = 18 };
        page.Children.Add(Card(BuildLook(), new Thickness(24, 20)));
        page.Children.Add(Card(BuildDefaults(), new Thickness(24, 20)));
        page.Children.Add(Card(BuildLayout(), new Thickness(24, 20)));
        page.Children.Add(Card(BuildBranches(), new Thickness(24, 20)));
        page.Children.Add(Card(BuildKeys(), new Thickness(24, 20)));
        page.Children.Add(Card(BuildDownloader(), new Thickness(24, 20)));
        View = page;
    }

    /// <summary>Reloads the settings and the key folder, for when the page is shown again or settings were imported.</summary>
    public void Refresh()
    {
        InstallerSettings settings = InstallerSettings.Load();
        ShowServers(settings);
        _downloader.Text = settings.DownloaderPath ?? "";
        ShowDownloaderState();
        var items = new List<KeyItem> { new(null) };
        items.AddRange(ClientConfiguration.AllPrivateKeys().Select(p => new KeyItem(p)));
        _defaultKey.ItemsSource = items;
        _refreshing = true;
        _defaultKey.SelectedItem = items.FirstOrDefault(i => i.Path == settings.DefaultKeyPath) ?? items[0];
        _refreshing = false;
        if (string.IsNullOrWhiteSpace(_importFor.Text) && settings.DefaultServer is { Length: > 0 } server)
            _importFor.Text = ServerLogin.ParseHost(server).Host;
        for (int i = 0; i < _branches.Length; i++)
            _branches[i].SelectedItem = InstallerSettings.ChoiceFor(settings.BranchFor(InstallerWindow.Components[i].Repository));
        RefreshKeyList();
        ShowAccounts();
        _ = LoadUsersAsync();
    }

    private Control BuildDefaults()
    {
        var panel = new StackPanel { Spacing = 10 };
        panel.Children.Add(Text("Servers", 15, weight: FontWeight.SemiBold));
        panel.Children.Add(Text("The IP addresses and DNS names of your servers. The login at startup fills in the default one and lists the others " +
                                "to choose from, and selects the default key when you log in with an SSH key. Changes are saved right away.", 12.5, "Pro.Muted"));
        panel.Children.Add(_serverList);
        panel.Children.Add(Label("Add a server (IP or hostname, with :port for another SSH port)"));
        var add = new Button { Content = "Add", Padding = new Thickness(22, 9), Classes = { "primary" } };
        add.Click += (_, _) => AddServer();
        _newServer.KeyDown += (_, e) => { if (e.Key == Avalonia.Input.Key.Enter) AddServer(); };
        var addRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        addRow.Children.Add(_newServer);
        addRow.Children.Add(add);
        panel.Children.Add(addRow);
        panel.Children.Add(Label("SSH key (from configuration/keys)"));
        panel.Children.Add(_defaultKey);
        _defaultKey.SelectionChanged += (_, _) => SaveKey();
        var clear = new Button { Content = "Clear all", Padding = new Thickness(18, 9), Classes = { "secondary" } };
        clear.Click += (_, _) =>
        {
            InstallerSettings cleared = InstallerSettings.Load();
            cleared.DefaultServer = null;
            cleared.Servers = [];
            cleared.DefaultKey = null;
            cleared.Save();
            Refresh();
            _defaultsResult.Show(ResultKind.Info, "No saved servers", "The login starts empty again.");
        };
        panel.Children.Add(clear);
        panel.Children.Add(_defaultsResult);
        return panel;
    }

    // The rows of the server list: the default first, with its choice ticked.
    private void ShowServers(InstallerSettings settings)
    {
        _serverList.Children.Clear();
        List<string> servers = settings.ServerList;
        if (servers.Count == 0)
        {
            _serverList.Children.Add(Text("No servers yet: add one below.", 12.5, "Pro.Subtle"));
            return;
        }
        foreach (string server in servers)
        {
            var choice = new RadioButton
            {
                GroupName = "defaultserver",
                Content = server == settings.DefaultServer ? $"{server}   (default)" : server,
                IsChecked = server == settings.DefaultServer,
                VerticalAlignment = VerticalAlignment.Center
            };
            choice.IsCheckedChanged += (_, _) => { if (choice.IsChecked == true && !_refreshing) ChangeServers(s => s.DefaultServer = server, "Default server", $"The login fills in {server}."); };
            var remove = new Button { Content = "Remove", Padding = new Thickness(14, 6), Classes = { "secondary" } };
            remove.Click += (_, _) => ChangeServers(s =>
            {
                List<string> rest = s.ServerList.Where(x => !x.Equals(server, StringComparison.OrdinalIgnoreCase)).ToList();
                s.Servers = rest;
                // The next one becomes the default when the default is removed.
                if (string.Equals(s.DefaultServer, server, StringComparison.OrdinalIgnoreCase)) s.DefaultServer = rest.FirstOrDefault();
            }, "Removed", $"{server} is no longer in the list.");
            var row = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), ColumnSpacing = 8, MaxWidth = 640, HorizontalAlignment = HorizontalAlignment.Left, MinWidth = 460 };
            row.Children.Add(choice);
            Grid.SetColumn(remove, 1);
            row.Children.Add(remove);
            _serverList.Children.Add(row);
        }
    }

    private void ChangeServers(Action<InstallerSettings> change, string heading, string message)
    {
        InstallerSettings settings = InstallerSettings.Load();
        settings.Servers = settings.ServerList;
        change(settings);
        settings.Save();
        _refreshing = true;
        ShowServers(settings);
        _refreshing = false;
        _defaultsResult.Show(ResultKind.Success, heading, message);
    }

    private void AddServer()
    {
        string server = (_newServer.Text ?? "").Trim();
        if (server.Length == 0) return;
        (string host, int port) = ServerLogin.ParseHost(server);
        if (host.Length == 0 || host.Any(char.IsWhiteSpace) || Uri.CheckHostName(host) == UriHostNameType.Unknown || port is < 1 or > 65535)
        {
            _defaultsResult.Show(ResultKind.Error, "That is not a valid server", "Use an IP address or hostname, optionally with :port.");
            return;
        }
        if (InstallerSettings.Load().ServerList.Contains(server, StringComparer.OrdinalIgnoreCase))
        {
            _defaultsResult.Show(ResultKind.Info, "Already in the list", $"{server} is saved already.");
            return;
        }
        ChangeServers(s =>
        {
            s.Servers.Add(server);
            // The first server is the default.
            s.DefaultServer ??= server;
        }, "Added", $"{server} is in the list" + (InstallerSettings.Load().DefaultServer is null ? " and is the default." : ". Tick it to make it the default."));
        _newServer.Text = "";
        if (string.IsNullOrWhiteSpace(_importFor.Text)) _importFor.Text = host;
    }

    private void SaveKey()
    {
        if (_refreshing) return;
        string? key = (_defaultKey.SelectedItem as KeyItem)?.Path;
        InstallerSettings settings = InstallerSettings.Load();
        settings.DefaultKey = key is null ? null : InstallerSettings.RelativeKey(key);
        settings.Save();
        _defaultsResult.Show(ResultKind.Success, "Saved", key is null ? "No default key." : $"The login selects the key {Path.GetFileName(key)}.");
    }

    private Control BuildLook()
    {
        var panel = new StackPanel { Spacing = 10 };
        panel.Children.Add(Text("Look", 15, weight: FontWeight.SemiBold));
        panel.Children.Add(Text("How the installer looks. Light or dark follows your system in both. A change applies when the installer starts again.", 12.5, "Pro.Muted"));
        bool hotel = InstallerSettings.Load().Look != InstallerSettings.ProfessionalLook;
        _hotelLook.IsChecked = hotel;
        _professionalLook.IsChecked = !hotel;
        panel.Children.Add(_hotelLook);
        panel.Children.Add(_professionalLook);
        var save = new Button { Content = "Save", Padding = new Thickness(22, 9), Classes = { "primary" } };
        save.Click += (_, _) => SaveLook();
        _restart.Click += (_, _) => RestartRequested?.Invoke();
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        buttons.Children.Add(save);
        buttons.Children.Add(_restart);
        panel.Children.Add(buttons);
        panel.Children.Add(_lookResult);
        return panel;
    }

    private void SaveLook()
    {
        InstallerSettings settings = InstallerSettings.Load();
        bool hotel = _hotelLook.IsChecked == true;
        settings.Look = hotel ? InstallerSettings.HotelLook : InstallerSettings.ProfessionalLook;
        settings.Save();
        // The theme is read once at startup, so a different choice waits for a restart.
        bool changed = hotel != ProfessionalTheme.Hotel;
        _restart.IsVisible = changed;
        _lookResult.Show(changed ? ResultKind.Info : ResultKind.Success, "Saved",
            changed ? $"The {(hotel ? "hotel" : "professional")} look starts with the next start of the installer: Restart now, or later."
                    : $"The {(hotel ? "hotel" : "professional")} look is the one you see now.");
    }

    private static TextBox LayoutBox(string placeholder) => new() { PlaceholderText = placeholder, MinWidth = 380, FontFamily = Mono, FontSize = 13 };

    private Control BuildLayout()
    {
        var panel = new StackPanel { Spacing = 8 };
        panel.Children.Add(Text("Server layout", 15, weight: FontWeight.SemiBold));
        panel.Children.Add(Text("Where the hotel lives on the server and the account the emulator runs as. The installer installs to these places, " +
                                "and the tools, addons and the dashboard look for everything there. Changing a value does not move anything on the server: " +
                                "move the folder yourself (or install again). It applies when the installer starts again.", 12.5, "Pro.Muted"));

        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*"), ColumnSpacing = 14, RowSpacing = 8, Margin = new Thickness(0, 6, 0, 0) };
        void Row(string label, Control input)
        {
            TextBlock text = Label(label);
            text.VerticalAlignment = VerticalAlignment.Center;
            input.HorizontalAlignment = HorizontalAlignment.Left;
            AddGridRow(grid, text, input);
        }
        Row("Emulator (Polaris clone)", _emulatorPath);
        Row("Emulator account", _emulatorAccount);
        Row("Emulator logs", _emulatorLogs);
        Row("Octane", _octanePath);
        Row("Octane-Renderer", _rendererPath);
        Row("Gamedata (assets, served on /gamedata)", _gamedataPath);
        Row("AtomCMS", _atomPath);
        Row("AtomCMS installed", _atomInstalled);
        Row("Database backups", _backupsPath);
        Row("Hotel database", _database);
        panel.Children.Add(grid);
        panel.Children.Add(_rootWarning);

        var save = new Button { Content = "Save", Padding = new Thickness(22, 9), Classes = { "primary" } };
        save.Click += (_, _) => SaveLayout();
        var reset = new Button { Content = "Defaults", Padding = new Thickness(18, 9), Classes = { "secondary" } };
        reset.Click += (_, _) =>
        {
            ShowLayout(new ServerLayout());
            _layoutResult.Show(ResultKind.Info, "The defaults are filled in", "Save to use them.");
        };
        _layoutRestart.Click += (_, _) => RestartRequested?.Invoke();
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        buttons.Children.Add(save);
        buttons.Children.Add(reset);
        buttons.Children.Add(_layoutRestart);
        panel.Children.Add(buttons);
        panel.Children.Add(_layoutResult);
        ShowLayout(InstallerSettings.Load().Layout ?? new ServerLayout());
        return panel;
    }

    private void ShowLayout(ServerLayout layout)
    {
        _emulatorPath.Text = layout.EmulatorRepository;
        _account = layout.EmulatorAccount;
        ShowAccounts();
        _emulatorLogs.Text = layout.EmulatorLogs;
        _octanePath.Text = layout.Octane;
        _rendererPath.Text = layout.Renderer;
        _gamedataPath.Text = layout.Gamedata;
        _atomPath.Text = layout.AtomCms;
        _atomInstalled.SelectedIndex = (int)layout.AtomCmsInstalled;
        _backupsPath.Text = layout.Backups;
        _database.Text = layout.Database;
        ShowRootWarning();
    }

    // root works, but the emulator then has every right on the server.
    private void ShowRootWarning()
    {
        if (_account == ServerLayout.RootAccount)
            _rootWarning.Show(ResultKind.Warning, "Use a normal account for the emulator, not root",
                "As root the emulator (and every plugin in it) can change anything on the server: a bug, or someone who finds a hole in it, " +
                "can take over the whole machine. A normal account such as emulator can only touch the hotel's files. The installer creates the account for you.");
        else
            _rootWarning.Hide();
    }

    // Fills the account list: the server's users when logged in, the chosen account, and "Create a new user".
    private void ShowAccounts()
    {
        ServerConnection? connection = _connection();
        List<ServerUser>? users = ReferenceEquals(_usersFor, connection) ? _users : null;
        var items = new List<AccountItem>();
        foreach (ServerUser user in users ?? [])
            items.Add(new AccountItem(user.Name, user.Uid == 0 ? "administrator, not recommended"
                : (user.IsSystem ? "service account" : $"user, uid {user.Uid}") + (user.InWwwData ? ", in www-data" : "") + (user.CanLogIn ? "" : ", no login")));
        if (items.All(i => i.Name != _account))
            items.Insert(0, new AccountItem(_account, connection is null ? "log in to see the server's users"
                : users is null ? "reading the server's users ..." : "not on the server yet: the Emulator step creates it"));
        items.Add(new AccountItem(null, connection is null ? "+ Create a new user (the Emulator step creates it) ..." : "+ Create a new user ..."));
        _settingAccounts = true;
        _emulatorAccount.ItemsSource = items;
        _emulatorAccount.SelectedItem = items.First(i => i.Name == _account);
        _settingAccounts = false;
        ShowRootWarning();
    }

    // Reads the users once per login (and again after creating one).
    private async Task LoadUsersAsync(bool force = false)
    {
        if (_connection() is not { } connection || (!force && ReferenceEquals(_usersFor, connection))) return;
        _usersFor = connection;
        _users = null;
        ShowAccounts();
        try
        {
            _users = await Task.Run(() => ServerUsers.ListAsync(connection));
        }
        catch (Exception ex)
        {
            _users = [];
            _layoutResult.Show(ResultKind.Warning, "Could not read the server's users", ex.Message);
        }
        ShowAccounts();
    }

    private async Task AccountChosenAsync()
    {
        if (_settingAccounts || _emulatorAccount.SelectedItem is not AccountItem item) return;
        if (item.Name is not null)
        {
            _account = item.Name;
            ShowRootWarning();
            return;
        }
        // "Create a new user": back to the current account until the new one exists.
        ShowAccounts();
        if (TopLevel.GetTopLevel(View) is not Window owner) return;
        ServerConnection? connection = _connection();
        string? name = await NameDialog.ShowAsync(owner, "New account for the emulator",
            connection is null
                ? "A service account (no login, home in /var/lib/<name>, member of www-data). You are not logged in, so the Emulator step creates it on the server."
                : $"A service account on {connection.Login.Host}, created now: no login, home in /var/lib/<name>, member of www-data. The Emulator step gives it the emulator's folders.",
            "hotel", "Create",
            text => !ServerLayout.IsValidAccount(text) ? "Use lower case letters, digits, '_' and '-', starting with a letter or '_'."
                : text == ServerLayout.RootAccount ? "root already exists, and is not recommended for the emulator."
                : _users?.Any(u => u.Name == text) == true ? $"{text} already exists: pick it in the list." : null);
        if (name is null) return;
        if (connection is not null)
        {
            try
            {
                await Task.Run(() => ServerUsers.CreateAsync(connection, name));
            }
            catch (Exception ex)
            {
                _layoutResult.Show(ResultKind.Error, $"Creating {name} failed", ex.Message);
                return;
            }
        }
        _account = name;
        _layoutResult.Show(ResultKind.Success, connection is null ? $"{name} is chosen" : $"{name} is created on {connection.Login.Host}",
            "Save to make it the emulator's account; the Emulator step gives it the emulator's folders.");
        if (connection is not null) await LoadUsersAsync(force: true);
        else ShowAccounts();
    }

    private void SaveLayout()
    {
        var layout = new ServerLayout
        {
            EmulatorRepository = _emulatorPath.Text ?? "",
            EmulatorAccount = _account,
            EmulatorLogs = _emulatorLogs.Text ?? "",
            Octane = _octanePath.Text ?? "",
            Renderer = _rendererPath.Text ?? "",
            Gamedata = _gamedataPath.Text ?? "",
            AtomCms = _atomPath.Text ?? "",
            AtomCmsInstalled = (AtomCmsPresence)Math.Max(0, _atomInstalled.SelectedIndex),
            Backups = _backupsPath.Text ?? "",
            Database = _database.Text ?? ""
        };
        layout.Normalize();
        if (layout.Validate() is { } problem)
        {
            _layoutResult.Show(ResultKind.Error, "Not saved", problem);
            return;
        }
        InstallerSettings settings = InstallerSettings.Load();
        settings.Layout = layout;
        settings.Save();
        ShowLayout(layout);
        // Like the look, the layout is read once at startup.
        bool changed = System.Text.Json.JsonSerializer.Serialize(layout) != System.Text.Json.JsonSerializer.Serialize(ServerLayout.Current);
        _layoutRestart.IsVisible = changed;
        _layoutResult.Show(changed ? ResultKind.Info : ResultKind.Success, "Saved",
            changed ? "The installer uses the new layout from its next start: Restart now, or later." : "This is the layout the installer uses now.");
    }

    private Control BuildBranches()
    {
        var panel = new StackPanel { Spacing = 10 };
        panel.Children.Add(Text("Repository branches", 15, weight: FontWeight.SemiBold));
        panel.Children.Add(Text("Which branch Install New Server clones for each repository: main for the stable version, dev for the newest changes. " +
                                "The clone steps start with what is chosen here, and a change made there is saved back to here. " +
                                "An existing clone on another branch is switched over by the step, never silently.", 12.5, "Pro.Muted"));
        for (int i = 0; i < _branches.Length; i++)
        {
            panel.Children.Add(Label($"{InstallerWindow.Components[i].Name}   (github.com/{InstallerWindow.Components[i].Repository})"));
            panel.Children.Add(_branches[i]);
        }
        var save = new Button { Content = "Save", Padding = new Thickness(22, 9), Classes = { "primary" } };
        save.Click += (_, _) => SaveBranches();
        panel.Children.Add(save);
        panel.Children.Add(_branchesResult);
        return panel;
    }

    private void SaveBranches()
    {
        InstallerSettings settings = InstallerSettings.Load();
        for (int i = 0; i < _branches.Length; i++) settings.SetBranch(InstallerWindow.Components[i].Repository, SelectedBranch(i));
        settings.Save();
        _branchesResult.Show(ResultKind.Success, "Saved",
            string.Join(", ", _branches.Select((_, i) => $"{InstallerWindow.Components[i].Name}: {SelectedBranch(i)}")) +
            ". The clone steps of the next installation start with this.");
    }

    private string SelectedBranch(int i) =>
        (_branches[i].SelectedItem as InstallerSettings.BranchChoice ?? InstallerSettings.BranchChoices[0]).Branch;

    private Control BuildKeys()
    {
        var panel = new StackPanel { Spacing = 10 };
        panel.Children.Add(Text("SSH keys", 15, weight: FontWeight.SemiBold));
        panel.Children.Add(Text($"Keys in {Path.Combine(ClientConfiguration.Directory, "keys")}: the ones the SSH key step generated, and the ones you import here. " +
                                "Import your own private key to log in with it (\"SSH key\" in the login); a public key alone can be installed for root in the SSH key step.",
            12.5, "Pro.Muted"));
        panel.Children.Add(_keyList);

        panel.Children.Add(Text("Import a key", 13.5, weight: FontWeight.SemiBold));
        panel.Children.Add(Label("For server (the folder in configuration/keys)"));
        panel.Children.Add(_importFor);
        var file = new Button { Content = "Import key file ...", Padding = new Thickness(16, 8), Classes = { "secondary" } };
        file.Click += async (_, _) => await ImportFileAsync();
        panel.Children.Add(file);
        panel.Children.Add(Label("Or paste a private key (OpenSSH, PEM, PuTTY .ppk) or a public key"));
        panel.Children.Add(_paste);
        var paste = new Button { Content = "Import pasted key", Padding = new Thickness(16, 8), Classes = { "secondary" } };
        paste.Click += async (_, _) =>
        {
            if (await ImportAsync(_paste.Text ?? "", "pasted key")) _paste.Text = "";
        };
        panel.Children.Add(paste);
        panel.Children.Add(_importResult);
        return panel;
    }

    private void RefreshKeyList()
    {
        _keyList.Children.Clear();
        string? preset = InstallerSettings.Load().DefaultKeyPath;
        string root = Path.Combine(ClientConfiguration.Directory, "keys");
        var files = Directory.Exists(root) ? Directory.GetFiles(root, "*.pub", SearchOption.AllDirectories).OrderBy(p => p, StringComparer.Ordinal).ToList() : [];
        foreach (string pub in files)
        {
            string text;
            try { text = File.ReadAllText(pub); } catch (IOException) { continue; }
            if (!SshKeys.TryParsePublicKey(text, out AuthorizedKey key, out _)) continue;
            string privatePath = pub[..^4];
            bool hasPrivate = File.Exists(privatePath);
            var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,Auto,*"), ColumnSpacing = 14 };
            row.Children.Add(Text($"keys/{Path.GetFileName(Path.GetDirectoryName(pub))}/{Path.GetFileName(hasPrivate ? privatePath : pub)}", 12.5, weight: FontWeight.SemiBold));
            TextBlock kind = Text(hasPrivate ? (privatePath == preset ? "private key · default" : "private key") : "public key only", 12, hasPrivate ? "Pro.SuccessText" : "Pro.Muted");
            Grid.SetColumn(kind, 1);
            row.Children.Add(kind);
            TextBlock detail = Text($"{key.Type}  {key.Fingerprint}", 12, "Pro.Subtle");
            detail.TextTrimming = TextTrimming.CharacterEllipsis;
            Grid.SetColumn(detail, 2);
            row.Children.Add(detail);
            _keyList.Children.Add(row);
        }
        if (_keyList.Children.Count == 0) _keyList.Children.Add(Text("No keys yet.", 12.5, "Pro.Muted"));
    }

    private async Task ImportFileAsync()
    {
        if (TopLevel.GetTopLevel(View) is not { } top) return;
        try
        {
            if (await SshKeyImport.PickFileAsync(top, "Select an SSH key (private or .pub)") is { } file) await ImportAsync(file.Text, file.Name);
        }
        catch (IOException ex)
        {
            _importResult.Show(ResultKind.Error, "That key file cannot be used", ex.Message);
        }
    }

    // A private key is stored with its public key. A public key on its own is stored as provided_*.pub.
    private async Task<bool> ImportAsync(string text, string source)
    {
        string folder = ServerLogin.ParseHost(_importFor.Text ?? "").Host;
        if (folder.Length == 0)
        {
            _importResult.Show(ResultKind.Error, "For which server?", "Enter the server the key is for: it becomes the folder in configuration/keys.");
            return false;
        }
        if (text.Trim().Length == 0)
        {
            _importResult.Show(ResultKind.Error, "Nothing to import", "Paste a key or choose a key file.");
            return false;
        }

        if (!SshKeys.IsPrivateKey(text))
        {
            if (!SshKeys.TryParsePublicKey(text, out AuthorizedKey publicKey, out string error))
            {
                _importResult.Show(ResultKind.Error, "Not an SSH key", error);
                return false;
            }
            string saved = ClientConfiguration.SavePublicKey(folder, publicKey);
            _importResult.Show(ResultKind.Success, "Public key imported",
                $"{saved}. The SSH key step can install it for root on {folder}. To log in with it, import the private key too.");
            RefreshKeyList();
            return true;
        }

        if (TopLevel.GetTopLevel(View) is not Window owner) return false;
        SshKeyImport.Imported? imported;
        try
        {
            imported = await SshKeyImport.ImportPrivateKeyAsync(owner, text, source, folder);
        }
        catch (FormatException ex)
        {
            _importResult.Show(ResultKind.Error, "Not a usable private key", ex.Message);
            return false;
        }
        if (imported is null) return false;
        _importResult.Show(ResultKind.Success, "Private key imported",
            $"{imported.Path} ({imported.Key.Type}, {imported.Key.Fingerprint}). Choose it as the default key above, or pick it under \"SSH key\" when logging in.");
        Refresh();
        return true;
    }

    private readonly TextBox _downloader = new() { PlaceholderText = "e.g. C:\\Tools\\All-in-1\\Habbo Downloader.exe" };
    private readonly ResultBanner _downloaderResult = new();

    private Control BuildDownloader()
    {
        var panel = new StackPanel { Spacing = 10 };
        panel.Children.Add(Text("All-in-1 downloader", 15, weight: FontWeight.SemiBold));
        panel.Children.Add(Text("The All-in-1 downloader (github.com/duckietm/all-in-1-converter) saves the Habbo assets in Habbo_Default next to its " +
                                "executable. Addons → Deploy Assets copies them from there to /var/www/gamedata on the server.", 12.5, "Pro.Muted"));
        panel.Children.Add(Label("Executable (Habbo Downloader.exe, or the Linux binary)"));
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), ColumnSpacing = 8 };
        row.Children.Add(_downloader);
        var browse = new Button { Content = "Browse ...", Padding = new Thickness(14, 7), Classes = { "secondary" } };
        browse.Click += async (_, _) => await BrowseDownloaderAsync();
        Grid.SetColumn(browse, 1);
        row.Children.Add(browse);
        panel.Children.Add(row);
        var save = new Button { Content = "Save", Padding = new Thickness(22, 9), Classes = { "primary" } };
        save.Click += (_, _) =>
        {
            InstallerSettings settings = InstallerSettings.Load();
            string path = (_downloader.Text ?? "").Trim().Trim('"');
            settings.DownloaderPath = path.Length > 0 ? path : null;
            settings.Save();
            ShowDownloaderState(saved: true);
        };
        panel.Children.Add(save);
        panel.Children.Add(_downloaderResult);
        return panel;
    }

    private void ShowDownloaderState(bool saved = false)
    {
        string path = (_downloader.Text ?? "").Trim().Trim('"');
        if (path.Length == 0)
        {
            if (saved) _downloaderResult.Show(ResultKind.Info, "No downloader set", "Deploy Assets needs it.");
            else _downloaderResult.Hide();
            return;
        }
        if (AssetSync.DownloaderFolder(path) is { } folder)
        {
            int furniture = Directory.Exists(Path.Combine(folder, "Habbo_Default", "hof_furni", "hab"))
                ? Directory.EnumerateFiles(Path.Combine(folder, "Habbo_Default", "hof_furni", "hab"), "*.hab").Count() : 0;
            _downloaderResult.Show(ResultKind.Success, saved ? "Saved" : "All-in-1 downloader found",
                $"{Path.Combine(folder, AssetSync.DefaultFolder)}: {furniture} furniture bundles (.hab) so far.");
        }
        else
            _downloaderResult.Show(ResultKind.Warning, saved ? "Saved, but Habbo_Default is not there" : "Habbo_Default is not next to this file",
                "Choose the downloader's executable; its folder needs Habbo_Default (the downloader makes it on its first run).");
    }

    private async Task BrowseDownloaderAsync()
    {
        if (TopLevel.GetTopLevel(View) is not { } top) return;
        IReadOnlyList<IStorageFile> files = await top.StorageProvider.OpenFilePickerAsync(
            new FilePickerOpenOptions { Title = "Select the All-in-1 downloader (Habbo Downloader)", AllowMultiple = false });
        if (files.Count == 0 || files[0].TryGetLocalPath() is not { } path) return;
        _downloader.Text = path;
        ShowDownloaderState();
    }

    private static TextBlock Label(string text) => Text(text, 12, "Pro.Muted", FontWeight.SemiBold);
}
