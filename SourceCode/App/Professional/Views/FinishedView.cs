using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Layout;
using Avalonia.Media;
using AllInOneInstaller.Configuration;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>How an install step ended, for the summary on the last page.</summary>
public enum StepSummary { Done, AlreadyInstalled, Skipped, Failed, NotRun }

/// <summary>Last wizard page: what every step did and where the game assets go.</summary>
public static class FinishedView
{

    /// <summary>Every folder of /var/www/gamedata and what goes in it (the layout the Octane step configures).</summary>
    public static readonly (string Folder, string Contents)[] Assets =
    [
        ("config/", "FurnitureData.json, ProductData.json, FigureData.json, FigureMap.json, EffectMap.json, HabboAvatarActions.json, ExternalTexts.json, UITexts.jsonc"),
        ("furniture/", "furniture bundles (<name>.hab)"),
        ("clothes/", "clothing bundles (<name>.hab)"),
        ("effect/", "avatar effect bundles (<name>.hab)"),
        ("pets/", "pet bundles (<name>.hab)"),
        ("bundled/generic/", "generic bundles (<name>.hab)"),
        ("room/", "room bundles (room/<name>/<name>.json)"),
        ("icons/", "furniture icons (<name>_icon.png)"),
        ("images/", "loading_icon.png, clear_icon.png, big_arrow.png, reception/ (hotel view) and wallet/ (currency icons)"),
        ("sounds/", "sounds (<sample>.mp3, sound_machine_sample_<n>.mp3)"),
        ("c_images/album1584/", "badges (<code>.gif); custom badges are added here by the emulator"),
        ("c_images/catalogue/", "catalogue headers and icons (<name>.gif, icon_<n>.png)"),
        ("c_images/reception/", "login screen (stretch_blue.png, sun.png, drape.png, ts.png, US_right.png ...)"),
        ("c_images/notifications/, Quests/, fx_icons/, habboway/, web_promo_small/, album1358/", "notification, achievement, effect and promo images"),
        ("c_images/groupbadge/badgeparts/", "group badge parts (badgepart_<part>.png)"),
        ("habbopages/", "the hotel's help/info pages"),
        ("custom/", "your own extra files (served as /custom/)"),
        ("news/news.json", "login screen news (a welcome message is already there)"),
        ("camera/, c_images/groupbadge/badge/", "filled by the emulator: do not upload")
    ];

    public static Control Build(string host, int sshPort, WebAccessSettings? site, string? puttyKey,
        IReadOnlyList<(string Title, StepSummary Result)> steps)
    {
        var page = new StackPanel { Spacing = 18 };

        bool clean = steps.All(s => s.Result is StepSummary.Done or StepSummary.AlreadyInstalled);
        var banner = new ResultBanner();
        banner.Show(clean ? ResultKind.Success : ResultKind.Warning,
            clean ? "Successfully completed" : "Completed, with steps to look at",
            (clean ? "The server is installed. " : "Some steps were skipped or failed (see below): run them again later if you need them. ") +
            "Now upload all the game assets to the server: download them with the All-in-1 downloader and upload them with WinSCP into the folders below.");
        page.Children.Add(banner);

        page.Children.Add(StepList(steps));
        page.Children.Add(Section("1. Download the assets",
            Text("Use the All-in-1 downloader (github.com/duckietm/all-in-1-converter) to download all assets (gamedata, furniture, clothes, badges ...).", 13)));
        page.Children.Add(Section("2. Upload them with WinSCP", WinScp(host, sshPort, puttyKey)));
        page.Children.Add(Section($"3. Where everything goes ({OctaneInstaller.Gamedata})", AssetTable()));
        page.Children.Add(Section("4. After uploading", After(site)));
        return page;
    }

    /// <summary>Last page of the AtomCMS addon: the web installer key, the paths it already has, and admin rights.</summary>
    public static Control BuildAtomCms(WebAccessSettings? site, string? installationKey, bool installationCompleted,
        IReadOnlyList<(string Title, StepSummary Result)> steps)
    {
        var page = new StackPanel { Spacing = 18 };
        bool clean = steps.All(s => s.Result is StepSummary.Done or StepSummary.AlreadyInstalled);
        string url = site?.Url ?? "your hotel";
        var banner = new ResultBanner();
        banner.Show(clean ? ResultKind.Success : ResultKind.Warning,
            clean ? "AtomCMS is installed" : "AtomCMS was not installed",
            clean
                ? $"{url} is now AtomCMS; Octane is on {site?.ClientUrl ?? "/client/"} and opens from the CMS after logging in."
                : "Run the AtomCMS step again when the server is ready (see the step for what is missing).");
        page.Children.Add(banner);
        page.Children.Add(StepList(steps));

        var installer = new StackPanel { Spacing = 6 };
        if (installationCompleted)
            installer.Children.Add(Text("The web installer is already finished. Change these settings later in the housekeeping (Website settings).", 13));
        else
        {
            installer.Children.Add(Text($"Open {url}: AtomCMS asks for its installation key first. Copy it from here:", 13));
            installer.Children.Add(installationKey is null
                ? Code("SELECT installation_key FROM website_installation;")
                : CopyBox(installationKey));
            installer.Children.Add(Text("Then go through the settings; the paths for this server are already filled in:", 13));
        }
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*"), ColumnSpacing = 18, RowSpacing = 4 };
        (string Key, string Value)[] settings = AtomCmsInstaller.WebsiteSettings("").Where(s => s.Key != "hotel_name").ToArray();
        for (int i = 0; i < settings.Length; i++)
        {
            grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
            var key = Text(settings[i].Key, 12.5, "Pro.Muted");
            Grid.SetRow(key, i);
            grid.Children.Add(key);
            var value = Code(settings[i].Value);
            Grid.SetRow(value, i);
            Grid.SetColumn(value, 1);
            grid.Children.Add(value);
        }
        installer.Children.Add(grid);
        page.Children.Add(Section("1. AtomCMS' web installer", installer));

        var admin = new StackPanel { Spacing = 6 };
        admin.Children.Add(Text($"Register your account on {url}, log out, and give it the highest rank while it is offline (HeidiSQL over the SSH tunnel, database habbo):", 13));
        admin.Children.Add(Code("UPDATE users SET `rank` = 7 WHERE username = 'YourName';"));
        admin.Children.Add(Text("The housekeeping is on /housekeeping (rank 6 and up).", 12, "Pro.Subtle"));
        page.Children.Add(Section("2. Become administrator", admin));

        var later = new StackPanel { Spacing = 6 };
        later.Children.Add(Text($"Captcha (Cloudflare Turnstile or Google reCAPTCHA): put the keys in {AtomCmsInstaller.Directory}/.env, then turn it on in the housekeeping.", 13));
        later.Children.Add(Text("Updating AtomCMS (git pull, composer install, migrations, theme) and Octane: run this addon again.", 13));
        later.Children.Add(Text($"Rebuilding only Octane (for /client): {OctaneInstaller.Octane}/build.sh.", 12, "Pro.Subtle"));
        page.Children.Add(Section("3. Later", later));
        return page;
    }

    /// <summary>Last page of the CMS addon with your own CMS: the database login to fill in, and what else is the owner's.</summary>
    public static Control BuildCustomCms(WebAccessSettings? site, string? name, string? root, bool php, DatabaseCredentials? credentials, string host,
        IReadOnlyList<(string Title, StepSummary Result)> steps)
    {
        var page = new StackPanel { Spacing = 18 };
        bool clean = steps.All(s => s.Result is StepSummary.Done or StepSummary.AlreadyInstalled);
        string url = site?.Url ?? "your hotel";
        var banner = new ResultBanner();
        banner.Show(clean ? ResultKind.Warning : ResultKind.Error,
            clean ? "Your CMS is installed: its database settings are next" : "Your CMS was not installed",
            clean
                ? $"{url} is now your CMS ({(name is null ? "" : CustomCmsInstaller.Directory(name))}, {(php ? "PHP" : "static")}, root {root ?? "/"}); Octane is on {site?.ClientUrl ?? "/client/"}."
                : "Run the step again when the server is ready (see the step for what is missing).");
        page.Children.Add(banner);
        page.Children.Add(StepList(steps));
        page.Children.Add(Section("1. Database settings of your CMS", CmsDatabaseLogin(credentials, host)));

        var hotel = new StackPanel { Spacing = 6 };
        hotel.Children.Add(Text("Point your CMS at the hotel: the client is on /client (the CMS opens it with the SSO ticket, as AtomCMS does), the images on /gamedata:", 13));
        hotel.Children.Add(Code($"client: /client/index.html?sso=<ticket>\nbadges: /gamedata/c_images/album1584\nfurniture icons: /gamedata/icons\nRCON: 127.0.0.1, the port in {EmulatorInstaller.Directory}/config.ini (rcon.port)"));
        page.Children.Add(Section("2. Hotel paths for your CMS", hotel));

        var later = new StackPanel { Spacing = 6 };
        later.Children.Add(Text("Updating: run this addon again (git pull for a GitHub link, or choose a new ZIP; your old folder is moved aside first).", 13));
        later.Children.Add(Text("PHP packages (composer install) or a theme build (npm) that your CMS needs: run them in the SSH terminal (Tools), in the CMS folder.", 13));
        later.Children.Add(Text("Back to AtomCMS: choose AtomCMS in Addons → CMS.", 12, "Pro.Subtle"));
        page.Children.Add(Section("3. Later", later));
        return page;
    }

    /// <summary>Last page of the Gitea addon: the address, the admin login and how to use it.</summary>
    public static Control BuildGitea(GiteaSettings? settings, GiteaResult? result, string loginFile, IReadOnlyList<(string Title, StepSummary Result)> steps)
    {
        var page = new StackPanel { Spacing = 18 };
        bool clean = steps.All(s => s.Result is StepSummary.Done or StepSummary.AlreadyInstalled);
        string url = settings?.Url ?? "your Gitea";
        var banner = new ResultBanner();
        banner.Show(!clean ? ResultKind.Warning : result is { CertificateValid: false } ? ResultKind.Warning : ResultKind.Success,
            clean ? $"Gitea runs on {url}" : "Gitea was not installed",
            !clean ? "Run the step again (see the step for what went wrong)."
            : result is { CertificateValid: false } ? $"{settings?.Domain} has no certificate yet: check its A record{(settings?.Cloudflare == true ? " (proxy on)" : "")}; Traefik keeps trying."
            : "Open it and log in as the admin.");
        page.Children.Add(banner);
        page.Children.Add(StepList(steps));

        var login = new StackPanel { Spacing = 6 };
        if (result?.AdminPassword is { } password)
        {
            login.Children.Add(Text($"Open {url} and log in as {settings?.AdminUser} with this password (saved on this computer in {loginFile}):", 13));
            login.Children.Add(CopyBox(password));
        }
        else login.Children.Add(Text($"The admin account was there already and is kept. A new password: docker exec -u git gitea gitea admin user change-password --username <name> --password <new>", 13));
        login.Children.Add(Text("Registration is closed: make accounts in Site Administration → User Accounts.", 12, "Pro.Subtle"));
        page.Children.Add(Section("1. Log in", login));

        var use = new StackPanel { Spacing = 6 };
        use.Children.Add(Text("Clone and push over https, with your Gitea name and password (or an access token from Settings → Applications):", 13));
        use.Children.Add(Code($"git clone {url}/<owner>/<repository>.git"));
        use.Children.Add(Text("SSH (git@...) is off: Cloudflare's proxy does not pass it, and the server's own SSH stays apart.", 12, "Pro.Subtle"));
        page.Children.Add(Section("2. Use it", use));

        var later = new StackPanel { Spacing = 6 };
        later.Children.Add(Text($"Update Gitea: run this addon again. Its repositories, accounts and settings are in {GiteaInstaller.Directory}/data: include it in your backups.", 13));
        later.Children.Add(Text($"Settings beyond these: {GiteaInstaller.Directory}/data/gitea/conf/app.ini (docs.gitea.com).", 12, "Pro.Subtle"));
        page.Children.Add(Section("3. Later", later));
        return page;
    }

    /// <summary>Last page of Remove the CMS.</summary>
    public static Control BuildRemoveCms(WebAccessSettings? site, string? removed, bool filesDeleted, IReadOnlyList<(string Title, StepSummary Result)> steps)
    {
        var page = new StackPanel { Spacing = 18 };
        bool clean = steps.All(s => s.Result is StepSummary.Done or StepSummary.AlreadyInstalled);
        var banner = new ResultBanner();
        banner.Show(clean ? ResultKind.Success : ResultKind.Warning,
            clean ? $"Octane is the website of {site?.Url ?? "your hotel"} again" : "The CMS was not removed",
            clean
                ? (removed is null ? "" : $"{removed} is removed{(filesDeleted ? " and its files are deleted" : "; its files stay on the server")}. ") +
                  "Octane has its own login screen again, and NGINX and Traefik are as after the server installation."
                : "Run the step again (see the step for what went wrong).");
        page.Children.Add(banner);
        page.Children.Add(StepList(steps));
        var later = new StackPanel { Spacing = 6 };
        later.Children.Add(Text("The CMS' tables and its users stay in the hotel database. Players log in on Octane's own login screen now.", 13));
        later.Children.Add(Text("A CMS again: Addons → CMS.", 13));
        page.Children.Add(Section("Next", later));
        return page;
    }

    /// <summary>The database login the server installation made for a CMS (configuration/database/&lt;server&gt;/mariadb.txt).</summary>
    public static Control CmsDatabaseLogin(DatabaseCredentials? credentials, string host)
    {
        var panel = new StackPanel { Spacing = 6 };
        panel.Children.Add(Text("The installer cannot fill in the database settings of a CMS it does not know: put these in your CMS' settings " +
                                "(for example DB_HOST, DB_DATABASE, DB_USERNAME and DB_PASSWORD in its .env). Use the cms account the server installation made, not root.", 13));
        if (credentials is null)
        {
            panel.Children.Add(Text($"The MariaDB passwords of {host} are not saved on this computer. They are in configuration/database/<server>/mariadb.txt on the computer that ran the MariaDB step.", 13, "Pro.WarningText"));
            return panel;
        }
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*"), ColumnSpacing = 18, RowSpacing = 4 };
        (string Key, string Value)[] rows =
        [
            ("Host", "127.0.0.1"), ("Port", credentials.Port.ToString()), ("Database", credentials.Database),
            ("User", credentials.CmsUser), ("Password", credentials.CmsPassword)
        ];
        for (int i = 0; i < rows.Length; i++)
        {
            grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
            var key = Text(rows[i].Key, 12.5, "Pro.Muted");
            Grid.SetRow(key, i);
            grid.Children.Add(key);
            Control value = rows[i].Key == "Password" ? CopyBox(rows[i].Value) : Code(rows[i].Value);
            Grid.SetRow(value, i);
            Grid.SetColumn(value, 1);
            grid.Children.Add(value);
        }
        panel.Children.Add(grid);
        panel.Children.Add(Text($"Saved on this computer in {ClientConfiguration.DatabaseCredentialsPath(host)}.", 12, "Pro.Subtle"));
        return panel;
    }

    /// <summary>Last page of Deploy Assets: what was sent and what to do next.</summary>
    public static Control BuildDeploy(WebAccessSettings? site, IEnumerable<string?> summaries, IReadOnlyList<(string Title, StepSummary Result)> steps)
    {
        var page = new StackPanel { Spacing = 18 };
        bool failed = steps.Any(s => s.Result is StepSummary.Failed or StepSummary.NotRun);
        string done = string.Join(" ", summaries.Where(s => !string.IsNullOrEmpty(s)));
        var banner = new ResultBanner();
        banner.Show(failed ? ResultKind.Warning : ResultKind.Success,
            failed ? "Not everything finished" : "The server has the assets",
            failed ? "Run the step again (see the step for the reason)." + (done.Length > 0 ? " Done: " + done : "")
                : done.Length > 0 ? done : "Nothing needed to change.");
        page.Children.Add(banner);
        page.Children.Add(StepList(steps));
        var next = new StackPanel { Spacing = 6 };
        next.Children.Add(Text($"Players get the new files when they reload {site?.ClientUrl ?? "the hotel"}.", 13));
        next.Children.Add(Text("New furniture also needs its rows in items_base and catalog_items: make the SQL with the All-in-1 converter " +
                               "(Hotel Tools → Generate SQL) and run it on the database (HeidiSQL over the SSH tunnel), then :update_items in the hotel or restart the emulator.", 13));
        next.Children.Add(Text("Download more with the All-in-1 downloader and sync again: only the new files are sent.", 12, "Pro.Subtle"));
        page.Children.Add(Section("Next", next));
        return page;
    }

    /// <summary>The text in large monospace with a Copy button, for pasting it elsewhere.</summary>
    public static Control CopyBox(string text)
    {
        var value = new SelectableTextBlock
        {
            Text = text,
            FontFamily = Mono,
            FontSize = 18,
            FontWeight = FontWeight.SemiBold,
            VerticalAlignment = VerticalAlignment.Center
        }.Bind(SelectableTextBlock.ForegroundProperty, "Pro.Text");
        var copy = new Button { Content = "Copy", Padding = new Thickness(18, 8), Classes = { "primary" }, VerticalAlignment = VerticalAlignment.Center };
        copy.Click += async (_, _) =>
        {
            if (TopLevel.GetTopLevel(copy)?.Clipboard is not { } clipboard) return;
            await clipboard.SetValueAsync(DataFormat.Text, text);
            copy.Content = "Copied";
        };
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), ColumnSpacing = 14 };
        row.Children.Add(value);
        Grid.SetColumn(copy, 1);
        row.Children.Add(copy);
        return new Border
        {
            Child = row,
            Padding = new Thickness(16, 10),
            CornerRadius = new CornerRadius(10),
            BorderThickness = new Thickness(1),
            HorizontalAlignment = HorizontalAlignment.Left,
            MinWidth = 520
        }.Bind(Border.BackgroundProperty, "Pro.Hover").Bind(Border.BorderBrushProperty, "Pro.CardBorder");
    }

    private static Control StepList(IReadOnlyList<(string Title, StepSummary Result)> steps)
    {
        var wrap = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach ((string title, StepSummary result) in steps)
        {
            (string icon, string color, string label) = result switch
            {
                StepSummary.Done => (Icons.Check, "Pro.SuccessText", "done"),
                StepSummary.AlreadyInstalled => (Icons.Check, "Pro.SuccessText", "already installed"),
                StepSummary.Skipped => (Icons.ChevronRight, "Pro.Muted", "skipped"),
                StepSummary.Failed => (Icons.Close, "Pro.ErrorText", "failed"),
                _ => (Icons.ChevronRight, "Pro.Muted", "not run")
            };
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(0, 0, 18, 6) };
            row.Children.Add(Icon(icon, 14).Bind(PathIcon.ForegroundProperty, color));
            row.Children.Add(Text(title, 12.5, weight: FontWeight.SemiBold));
            row.Children.Add(Text(label, 12, "Pro.Subtle"));
            wrap.Children.Add(row);
        }
        return wrap;
    }

    private static Control Section(string heading, Control content)
    {
        var panel = new StackPanel { Spacing = 8 };
        panel.Children.Add(Text(heading, 15, weight: FontWeight.SemiBold));
        panel.Children.Add(content);
        return panel;
    }

    private static SelectableTextBlock Code(string text) =>
        new SelectableTextBlock { Text = text, FontFamily = Mono, FontSize = 12, TextWrapping = TextWrapping.Wrap }
            .Bind(SelectableTextBlock.ForegroundProperty, "Pro.Text");

    private static Control WinScp(string host, int sshPort, string? puttyKey)
    {
        var panel = new StackPanel { Spacing = 6 };
        panel.Children.Add(Text("New session in WinSCP:", 13));
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*"), ColumnSpacing = 14, RowSpacing = 4 };
        (string, string)[] rows =
        [
            ("File protocol", "SFTP"),
            ("Host name / port", $"{host} / {sshPort}"),
            ("User name", "root"),
            ("Private key", (puttyKey ?? "your .ppk key") + "   (Advanced... > SSH > Authentication > Private key file)"),
            ("Upload to", OctaneInstaller.Gamedata + "/  (keep the folder names of the table below)")
        ];
        for (int i = 0; i < rows.Length; i++)
        {
            grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
            var label = Text(rows[i].Item1, 12.5, "Pro.Muted");
            Grid.SetRow(label, i);
            grid.Children.Add(label);
            var value = Code(rows[i].Item2);
            Grid.SetRow(value, i);
            Grid.SetColumn(value, 1);
            grid.Children.Add(value);
        }
        panel.Children.Add(grid);
        panel.Children.Add(Text("WinSCP uses the .ppk directly; with a key password it asks for it once (or load the .ppk in Pageant).", 12, "Pro.Subtle"));
        return panel;
    }

    private static Control AssetTable()
    {
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*"), ColumnSpacing = 18, RowSpacing = 6 };
        for (int i = 0; i < Assets.Length; i++)
        {
            grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
            var folder = Code(OctaneInstaller.Gamedata + "/" + Assets[i].Folder);
            folder.FontWeight = FontWeight.SemiBold;
            folder.MaxWidth = 380;
            Grid.SetRow(folder, i);
            grid.Children.Add(folder);
            var contents = Text(Assets[i].Contents, 12.5);
            Grid.SetRow(contents, i);
            Grid.SetColumn(contents, 1);
            grid.Children.Add(contents);
        }
        return grid;
    }

    private static Control After(WebAccessSettings? site)
    {
        var panel = new StackPanel { Spacing = 6 };
        panel.Children.Add(Text("Give the emulator (group www-data) write access to the new files: run this on the server once the upload is done:", 13));
        panel.Children.Add(Code($"sudo {OctaneInstaller.PermissionsScript}"));
        panel.Children.Add(Text($"Open the hotel{(site is null ? "" : " at " + site.Url)}, register the first account, log out, and make it administrator while it is offline (HeidiSQL over the SSH tunnel, database habbo):", 13));
        panel.Children.Add(Code("UPDATE users SET `rank` = 7 WHERE username = 'YourName';"));
        panel.Children.Add(Text("Log in again to get the rank. Changed the Octane configuration? Rebuild it with /var/www/Octane/build.sh.", 12, "Pro.Subtle"));
        return panel;
    }
}
