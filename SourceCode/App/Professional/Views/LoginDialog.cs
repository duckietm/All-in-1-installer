using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using AllInOneInstaller.Configuration;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>
/// The login at startup: server, account and a password or an SSH key. A missing key can be imported here. Returns
/// the connection, logged in with root rights, or null when the user chose to continue without a server.
/// </summary>
public static class LoginDialog
{
    /// <summary>What to fill in: the previous login (after a lost connection), never its passwords.</summary>
    public sealed record Prefill(string Host, string User, bool UseKey, string? KeyPath);

    // ToString is what the key list shows.
    private sealed record KeyChoice(string Path)
    {
        public override string ToString()
        {
            string folder = System.IO.Path.GetFileName(System.IO.Path.GetDirectoryName(Path)) ?? "";
            return Path.StartsWith(ClientConfiguration.Directory, StringComparison.Ordinal) ? $"{System.IO.Path.GetFileName(Path)}   (keys/{folder})" : Path;
        }
    }

    public static async Task<ServerConnection?> ShowAsync(Window owner, Prefill? prefill, string? notice)
    {
        InstallerSettings settings = InstallerSettings.Load();
        var dialog = new Window
        {
            Title = "Log in to your server",
            Width = 640,
            SizeToContent = SizeToContent.Height,
            CanResize = false,
            WindowStartupLocation = WindowStartupLocation.CenterOwner
        };
        dialog.Bind(Window.BackgroundProperty, "Pro.Card");
        ServerConnection? result = null;
        bool busy = false;

        var host = new TextBox { Text = prefill?.Host ?? settings.DefaultServer ?? "", PlaceholderText = "192.168.1.10 or hotel.example.com (add :2222 for another SSH port)" };
        var user = new TextBox { Text = prefill?.User ?? "root", PlaceholderText = "root or a user with sudo rights" };
        var password = new TextBox { PlaceholderText = "Password of the account", PasswordChar = '•' };
        var keyPassword = new TextBox { PlaceholderText = "Leave empty when the key has no password", PasswordChar = '•' };
        foreach (TextBox box in new[] { host, user, password, keyPassword })
        {
            box.FontSize = 14;
            box.Padding = new Thickness(12, 9);
        }
        bool startWithKey = prefill?.UseKey ?? (settings.DefaultKeyPath is not null || ClientConfiguration.AllPrivateKeys().Count > 0);
        var usePassword = new RadioButton { GroupName = "startlogin", Content = "Password", IsChecked = !startWithKey };
        var useKey = new RadioButton { GroupName = "startlogin", Content = "SSH key", IsChecked = startWithKey };
        var keyChoice = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch };
        var browse = new Button { Content = "Browse ...", Padding = new Thickness(14, 7), Classes = { "secondary" } };
        var import = new Button { Content = "Import key ...", Padding = new Thickness(14, 7), Classes = { "secondary" } };
        TextBlock noKeys = Text("There is no SSH key in configuration/keys yet. Import your private key (OpenSSH, PEM or PuTTY .ppk): " +
                                "it is copied to configuration/keys/<server> and stays on this computer.", 12.5, "Pro.WarningText");
        noKeys.TextWrapping = TextWrapping.Wrap;
        var checks = new CheckList("Log in over SSH", "Check operating system", "Switch to root") { IsVisible = false };
        var progress = new ProgressBar { IsIndeterminate = true, Height = 3, MinHeight = 3, Foreground = Solid(Brand), IsVisible = false };
        var banner = new ResultBanner();
        TextBlock error = Text("", 12.5, "Pro.ErrorText");
        error.TextWrapping = TextWrapping.Wrap;
        var connect = new Button { Content = "Connect", Padding = new Thickness(22, 9), Classes = { "primary" } };
        var later = new Button { Content = "Not now", Padding = new Thickness(18, 9), Classes = { "secondary" } };
        if (notice is not null) banner.Show(ResultKind.Warning, notice, "Log in again to go on, or choose Not now.");

        // A key you browsed for stays in the list.
        var browsed = new List<string>();
        string? picked = prefill?.KeyPath;
        void RefreshKeys()
        {
            string? preset = settings.DefaultKeyPath;
            var paths = browsed.Concat(ClientConfiguration.AllPrivateKeys()).Distinct().ToList();
            if (preset is not null && !paths.Contains(preset)) paths.Insert(0, preset);
            if (picked is not null && File.Exists(picked) && !paths.Contains(picked)) paths.Insert(0, picked);
            // The key you picked, the default key from Settings, a key in a folder named after the server, the newest key.
            string server = ServerLogin.ParseHost(host.Text ?? "").Host;
            string Folder(string path) => Path.GetFileName(Path.GetDirectoryName(path)) ?? "";
            string? forHost = server.Length == 0 ? null
                : paths.FirstOrDefault(p => Folder(p).Equals(server, StringComparison.OrdinalIgnoreCase))
                  ?? paths.FirstOrDefault(p => Folder(p).Contains(server, StringComparison.OrdinalIgnoreCase));
            var items = paths.Select(p => new KeyChoice(p)).ToList();
            string? choose = picked ?? preset ?? forHost;
            keyChoice.ItemsSource = items;
            keyChoice.SelectedItem = items.FirstOrDefault(k => k.Path == choose) ?? items.FirstOrDefault();
            keyChoice.PlaceholderText = items.Count == 0 ? "No keys yet: Import key or Browse" : null;
            noKeys.IsVisible = items.Count == 0;
            import.Classes.Set("primary", items.Count == 0);
            import.Classes.Set("secondary", items.Count > 0);
        }
        keyChoice.SelectionChanged += (_, _) =>
        {
            if (keyChoice.SelectedItem is KeyChoice key) picked = key.Path;
            error.Text = "";
        };
        host.LostFocus += (_, _) => { if (picked is null) RefreshKeys(); };

        var passwordPanel = new StackPanel { Spacing = 6 };
        passwordPanel.Children.Add(Label("Password (also for sudo when the account is not root)"));
        passwordPanel.Children.Add(password);
        var keyRow = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto,Auto"), ColumnSpacing = 8 };
        keyRow.Children.Add(keyChoice);
        Grid.SetColumn(browse, 1);
        keyRow.Children.Add(browse);
        Grid.SetColumn(import, 2);
        keyRow.Children.Add(import);
        var keyPanel = new StackPanel { Spacing = 6 };
        keyPanel.Children.Add(Label("Private key"));
        keyPanel.Children.Add(keyRow);
        keyPanel.Children.Add(noKeys);
        keyPanel.Children.Add(Label("Password of the key"));
        keyPanel.Children.Add(keyPassword);
        void UpdateMethod()
        {
            bool key = useKey.IsChecked == true;
            passwordPanel.IsVisible = !key;
            keyPanel.IsVisible = key;
            if (key) RefreshKeys();
            error.Text = "";
        }
        usePassword.IsCheckedChanged += (_, _) => UpdateMethod();
        useKey.IsCheckedChanged += (_, _) => UpdateMethod();

        browse.Click += async (_, _) =>
        {
            IReadOnlyList<IStorageFile> files = await dialog.StorageProvider.OpenFilePickerAsync(
                new FilePickerOpenOptions { Title = "Select your private SSH key", AllowMultiple = false });
            if (files.Count == 0 || files[0].TryGetLocalPath() is not { } path) return;
            browsed.Remove(path);
            browsed.Insert(0, path);
            picked = path;
            RefreshKeys();
        };
        import.Click += async (_, _) =>
        {
            string server = ServerLogin.ParseHost(host.Text ?? "").Host;
            if (server.Length == 0) { error.Text = "Enter the server first: the key is stored in a folder named after it."; host.Focus(); return; }
            try
            {
                if (await SshKeyImport.PickFileAsync(dialog, "Select your private SSH key") is not { } file) return;
                if (!SshKeys.IsPrivateKey(file.Text))
                {
                    error.Text = $"{file.Name} is not a private key. Logging in needs the private key (a .pub file is only the public half).";
                    return;
                }
                if (await SshKeyImport.ImportPrivateKeyAsync(dialog, file.Text, file.Name, server) is not { } imported) return;
                picked = imported.Path;
                RefreshKeys();
                banner.Show(ResultKind.Success, "Key imported", $"{imported.Path} ({imported.Key.Type}). Enter its password below when it has one.");
            }
            catch (Exception ex) when (ex is IOException or FormatException or UnauthorizedAccessException)
            {
                error.Text = ex.Message;
            }
        };

        string? Validate()
        {
            if (string.IsNullOrWhiteSpace(host.Text)) return "Enter the server IP address or hostname.";
            (string server, int port) = ServerLogin.ParseHost(host.Text);
            if (server.Length == 0 || server.Any(char.IsWhiteSpace) || Uri.CheckHostName(server) == UriHostNameType.Unknown) return "That is not a valid IP address or hostname.";
            if (port is < 1 or > 65535) return "The SSH port must be between 1 and 65535.";
            string account = user.Text?.Trim() ?? "";
            if (account.Length == 0) return "Enter the user account to log in with.";
            if (account.Any(c => char.IsWhiteSpace(c) || c == ':' || c == '@')) return "A user name cannot contain spaces, ':' or '@'.";
            if (useKey.IsChecked != true) return string.IsNullOrEmpty(password.Text) ? "Enter the password." : null;
            if (keyChoice.SelectedItem is not KeyChoice key) return "Choose your private key: Import key or Browse.";
            try
            {
                // Checked here so a wrong key password is a clear message instead of a refused login.
                SshKeys.PublicKeyOf(File.ReadAllText(key.Path), keyPassword.Text ?? "", "");
            }
            catch (Exception ex) when (ex is SshKeys.KeyPasswordException or FormatException or IOException or UnauthorizedAccessException)
            {
                return ex.Message;
            }
            return null;
        }

        void SetBusy(bool value)
        {
            busy = value;
            progress.IsVisible = value;
            foreach (Control control in new Control[] { host, user, password, keyPassword, usePassword, useKey, keyChoice, browse, import, connect, later })
                control.IsEnabled = !value;
        }

        async Task ConnectAsync()
        {
            if (busy) return;
            if (Validate() is { } problem) { error.Text = problem; return; }
            error.Text = "";
            (string server, int port) = ServerLogin.ParseHost(host.Text!);
            string account = user.Text!.Trim();
            ServerLogin login = useKey.IsChecked == true
                ? new ServerLogin(server, port, account, "", [((KeyChoice)keyChoice.SelectedItem!).Path], keyPassword.Text ?? "")
                : new ServerLogin(server, port, account, password.Text ?? "");
            SetBusy(true);
            banner.Hide();
            checks.Reset();
            checks.IsVisible = true;
            int stage = 0;
            void Stage(ConnectStage reached) => Dispatcher.UIThread.Post(() =>
            {
                if ((int)reached <= stage) return;
                stage = (int)reached;
                checks.Update(stage, failed: false);
            });
            try
            {
                // SSH.NET does blocking work while connecting; keep it off the UI thread.
                ServerConnection connection = await Task.Run(() => ServerConnection.ConnectAsync(login, _ => { }, Stage));
                await Dispatcher.UIThread.InvokeAsync(() => { }, DispatcherPriority.Background);
                result = connection;
                // Not busy any more, or Closing would keep the dialog open.
                SetBusy(false);
                dialog.Close();
            }
            catch (Exception ex)
            {
                await Dispatcher.UIThread.InvokeAsync(() => { }, DispatcherPriority.Background);
                checks.Update(stage, failed: true);
                banner.Show(ResultKind.Error, "Connection failed", ex is ServerConnectionException ? ex.Message : $"{ex.GetType().Name}: {ex.Message}");
            }
            finally
            {
                SetBusy(false);
            }
        }

        connect.Click += async (_, _) => await ConnectAsync();
        later.Click += (_, _) => dialog.Close();
        foreach (TextBox box in new[] { host, user, password, keyPassword })
        {
            box.TextChanged += (_, _) => error.Text = "";
            box.KeyDown += async (_, e) =>
            {
                if (e.Key == Key.Enter) { e.Handled = true; await ConnectAsync(); }
                else if (e.Key == Key.Escape && !busy) { e.Handled = true; dialog.Close(); }
            };
        }
        // A login that is half-way is finished or fails first.
        dialog.Closing += (_, e) => { if (busy) e.Cancel = true; };

        var panel = new StackPanel { Spacing = 10, Margin = new Thickness(28, 24) };
        var top = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*"), ColumnSpacing = 14 };
        var icon = Icon(Icons.Server, 22);
        icon.Foreground = Solid(Brand);
        top.Children.Add(new Border
        {
            Width = 46,
            Height = 46,
            CornerRadius = new CornerRadius(12),
            Background = Solid(Color.FromArgb(0x26, Brand.R, Brand.G, Brand.B)),
            Child = icon
        });
        var heading = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        heading.Children.Add(Title("Log in to your server", 21));
        TextBlock subtitle = Text("One login for everything: installing, the addons and the tools. It stays open until you close the program.", 12.5, "Pro.Muted");
        subtitle.TextWrapping = TextWrapping.Wrap;
        heading.Children.Add(subtitle);
        Grid.SetColumn(heading, 1);
        top.Children.Add(heading);
        panel.Children.Add(top);
        panel.Children.Add(banner);
        panel.Children.Add(Label("Server IP / hostname"));
        panel.Children.Add(host);
        panel.Children.Add(Label("User"));
        panel.Children.Add(user);
        var method = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 18 };
        method.Children.Add(Text("Log in with", 12.5, "Pro.Muted", FontWeight.SemiBold));
        ((TextBlock)method.Children[0]).VerticalAlignment = VerticalAlignment.Center;
        method.Children.Add(usePassword);
        method.Children.Add(useKey);
        panel.Children.Add(method);
        panel.Children.Add(passwordPanel);
        panel.Children.Add(keyPanel);
        panel.Children.Add(error);
        panel.Children.Add(progress);
        panel.Children.Add(checks);
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        buttons.Children.Add(later);
        buttons.Children.Add(connect);
        panel.Children.Add(buttons);
        dialog.Content = panel;
        UpdateMethod();
        dialog.Opened += (_, _) =>
            (string.IsNullOrWhiteSpace(host.Text) ? host : useKey.IsChecked == true ? (Control)keyPassword : password).Focus();
        await dialog.ShowDialog(owner);
        return result;
    }

    private static TextBlock Label(string text) => Text(text, 12, "Pro.Muted", FontWeight.SemiBold);
}
