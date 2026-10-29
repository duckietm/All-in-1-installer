using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using AllInOneInstaller.Configuration;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>The last wizard page, from what the steps did.</summary>
public delegate Control FinishPage(string host, int sshPort, WebAccessSettings? site, string? puttyKey,
    IReadOnlyList<(string Title, StepSummary Result)> steps);

/// <summary>
/// Runs install steps one after the other on the server of the login at startup. "Install New Server" starts with the
/// SSH key step (an SSH key for root); the addons start with their own steps. Back returns to the dashboard and keeps
/// both the login and where the wizard was.
/// </summary>
public sealed class ServerWizard
{
    private readonly Func<ServerConnection?> _session;
    // The login this wizard's progress belongs to; a new login starts it over.
    private ServerConnection? _startedFor;
    private readonly bool _hasKeyStep;
    private int _index;

    // Steps in Auto columns, the lines between them in star columns, so the row shrinks to the card width.
    private readonly Grid _stepper = new();
    private bool _compactStepper;
    private readonly ContentControl _body = new();
    private readonly TextBlock _validation = Text("", 12.5, "Pro.ErrorText");
    private readonly Button _next = new() { Padding = new Thickness(22, 9), Classes = { "primary" } };
    // Leaves the wizard for the dashboard; the login stays open and the wizard keeps its place.
    private readonly Button _leave = new() { Content = "Back", Padding = new Thickness(18, 9), Classes = { "secondary" } };
    private readonly Button _abort = new() { Content = "Abort", Padding = new Thickness(18, 9), Classes = { "secondary" } };
    private readonly Button _anotherKey = new() { Content = "Install another key", Padding = new Thickness(18, 9), Classes = { "secondary" } };
    private readonly Button _skip = new() { Content = "Skip", Padding = new Thickness(18, 9), Classes = { "secondary" } };
    private readonly Button _login = new() { Content = "Log in", Padding = new Thickness(22, 9), Classes = { "primary" } };
    // What the check found when the step opened: already installed means Skip is the main action.
    private bool _keyAlreadyInstalled;
    private readonly Button _continue = new() { Padding = new Thickness(22, 9), Classes = { "primary" } };
    private readonly Button _openSite = new() { Padding = new Thickness(22, 9), Classes = { "primary" } };
    private Control? _finishView;
    private string? _siteUrl;

    /// <summary>The address the finish page's Open button opens; without it, the hotel's.</summary>
    public Func<string?>? OpenUrl { get; init; }
    private readonly StackPanel _buttons = new() { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
    private readonly Control _notConnected;

    private readonly SshKeyStep _keyStep = new();
    private KeyStepOutcome? _keyOutcome;

    /// <summary>The full server installation, in order. A new step only needs adding here.</summary>
    public static InstallStep[] ServerSteps() =>
    [
        new NginxStep(), new PhpStep(), new MariaDbStep(), new DevToolsStep(),
        new CloneStep("Polaris", "Emulator", "duckietm/Polaris-Emulator", EmulatorInstaller.Repository,
            "The Polaris game server (emulator): Java sources, the database and the hotel assets."),
        new CloneStep("Octane", "Client", "duckietm/Octane", OctaneInstaller.Octane,
            "The Octane browser client: the hotel's user interface."),
        new CloneStep("Renderer", "Octane-Renderer", "duckietm/Octane-Renderer", OctaneInstaller.Renderer,
            "The Octane Renderer: draws rooms, avatars and furniture for Octane."),
        new EmulatorStep(), new WebAccessStep(), new OctaneStep(), new HardenStep(), new SshLoginStep()
    ];

    // Install steps after the SSH key, in order.
    private readonly InstallStep[] _installSteps;
    private readonly FinishPage _finishPage;
    private readonly string _finishCaption;
    private readonly string _finishTitle;
    private readonly StepOutcome?[] _installOutcomes;
    // Failed this session and skipped afterwards, not fixed; for the summary.
    private readonly bool[] _installFailed;
    private readonly bool[] _installAlreadyDone;

    public Control View { get; }
    /// <summary>The login at startup while it is connected.</summary>
    public ServerConnection? Connection => _session() is { IsConnected: true } connection ? connection : null;
    public bool IsBusy { get; private set; }
    public string StatusMessage { get; private set; } = "Ready.";
    public event Action? StateChanged;
    /// <summary>Back, or Abort after an aborted run: the window shows the dashboard.</summary>
    public event Action? Exited;
    /// <summary>"Log in" while there is no login: the window opens the login.</summary>
    public event Action? LoginRequested;

    private int KeyIndex => _hasKeyStep ? 0 : -1;
    private bool OnKeyStep => _index == KeyIndex;
    private int FirstInstallIndex => _hasKeyStep ? 1 : 0;
    private bool OnInstallStep => _index >= FirstInstallIndex && _index < FirstInstallIndex + _installSteps.Length;
    private int FinishIndex => FirstInstallIndex + _installSteps.Length;
    private bool OnFinishStep => _index == FinishIndex;
    // Only meaningful while OnInstallStep.
    private int InstallStepIndex => _index - FirstInstallIndex;

    /// <summary>Install New Server: the SSH key step, then the full installation.</summary>
    public ServerWizard(Func<ServerConnection?> session) : this(session, ServerSteps(), FinishedView.Build, "Upload assets", keyStep: true)
    {
    }

    public ServerWizard(Func<ServerConnection?> session, InstallStep[] installSteps, FinishPage finishPage, string finishCaption, bool keyStep,
        string finishTitle = "Completed")
    {
        _session = session;
        _finishTitle = finishTitle;
        _installSteps = installSteps;
        _finishPage = finishPage;
        _finishCaption = finishCaption;
        _hasKeyStep = keyStep;
        _notConnected = BuildNotConnected();

        _next.Click += async (_, _) => await NextAsync();
        _leave.Click += (_, _) =>
        {
            if (IsBusy) return;
            // Leaving with Back ends this run: opening the wizard again starts at its first step (the login stays).
            _startedFor = null;
            Exited?.Invoke();
        };
        _login.Click += (_, _) => LoginRequested?.Invoke();
        _keyStep.Status += SetStatus;
        _installOutcomes = new StepOutcome?[_installSteps.Length];
        _installAlreadyDone = new bool[_installSteps.Length];
        _installFailed = new bool[_installSteps.Length];
        foreach (InstallStep step in _installSteps) step.Status += SetStatus;
        _continue.Click += async (_, _) =>
        {
            if (IsBusy || !OnInstallStep) return;
            if (InstallStepIndex + 1 < _installSteps.Length) await EnterInstallStepAsync(InstallStepIndex + 1);
            else await EnterFinishAsync();
        };
        _skip.Click += async (_, _) =>
        {
            if (IsBusy || Connection is null) return;
            if (OnKeyStep)
            {
                SetStatus("SSH key step skipped.");
                await EnterInstallStepAsync(0);
            }
            else if (OnInstallStep)
            {
                int i = InstallStepIndex;
                _installOutcomes[i] = StepOutcome.Skipped;
                SetStatus($"{_installSteps[i].Title} step skipped.");
                if (i + 1 < _installSteps.Length) await EnterInstallStepAsync(i + 1);
                else await EnterFinishAsync();
            }
        };
        _openSite.Click += async (_, _) =>
        {
            if (_siteUrl is not null && TopLevel.GetTopLevel(View) is { } top)
                await top.Launcher.LaunchUriAsync(new Uri(_siteUrl));
        };
        _anotherKey.Click += async (_, _) =>
        {
            if (IsBusy || Connection is null) return;
            await EnterKeyStepAsync();
        };
        _abort.Click += (_, _) =>
        {
            if (IsBusy) return;
            // Start over next time; the login stays.
            _startedFor = null;
            SetStatus("Installation aborted.");
            Exited?.Invoke();
        };

        var layout = new StackPanel { Spacing = 22 };
        layout.Children.Add(_stepper);
        layout.Children.Add(new Border { Height = 1 }.Bind(Border.BackgroundProperty, "Pro.CardBorder"));
        layout.Children.Add(_body);
        var footer = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), ColumnSpacing = 12 };
        _validation.VerticalAlignment = VerticalAlignment.Center;
        footer.Children.Add(_validation);
        Grid.SetColumn(_buttons, 1);
        footer.Children.Add(_buttons);
        layout.Children.Add(footer);
        View = Card(layout, new Thickness(28, 24));
        // When the captions of all steps do not fit (about 115 px each), only the current step keeps its caption.
        View.SizeChanged += (_, e) =>
        {
            bool compact = e.NewSize.Width < (FinishIndex + 1) * 115;
            if (compact == _compactStepper) return;
            _compactStepper = compact;
            RenderStepper();
        };

        Render();
    }

    /// <summary>
    /// Called each time the page is shown: asks for a login when there is none, starts the first step for a new
    /// login, or shows the step where the wizard was.
    /// </summary>
    public async Task OpenAsync()
    {
        if (IsBusy) return;
        ServerConnection? connection = Connection;
        if (connection is null)
        {
            Render();
            return;
        }
        // Back from another page (the sidebar, Tools) in the middle of a run continues it; a finished run starts over.
        if (ReferenceEquals(_startedFor, connection) && !OnFinishStep)
        {
            Render();
            return;
        }
        _startedFor = connection;
        _keyOutcome = null;
        _finishView = null;
        Array.Clear(_installOutcomes);
        Array.Clear(_installFailed);
        Array.Clear(_installAlreadyDone);
        await StartAsync();
    }

    private Task StartAsync() =>
        _hasKeyStep ? EnterKeyStepAsync() : _installSteps.Length > 0 ? EnterInstallStepAsync(0) : EnterFinishAsync();

    public void FocusCurrentStep() =>
        Dispatcher.UIThread.Post(() =>
        {
            if (OnKeyStep && !_keyStep.ShowingRun) _keyStep.FocusInput();
        }, DispatcherPriority.Background);

    private async Task NextAsync()
    {
        if (IsBusy) return;
        if (OnKeyStep) await KeyStepNextAsync();
        else if (OnInstallStep) await InstallStepNextAsync();
    }

    private void Render()
    {
        _validation.Text = "";
        RenderStepper();
        _buttons.Children.Clear();

        if (Connection is null && !IsBusy)
        {
            _body.Content = _notConnected;
            _buttons.Children.Add(_login);
            return;
        }
        if (OnKeyStep)
        {
            _body.Content = _keyStep.View;
            UpdateKeyButtons();
            FocusCurrentStep();
            return;
        }
        if (OnInstallStep)
        {
            _body.Content = _installSteps[InstallStepIndex].View;
            UpdateInstallButtons();
            return;
        }
        if (OnFinishStep)
        {
            _body.Content = _finishView;
            if (!IsBusy)
            {
                _buttons.Children.Add(_leave);
                if (_siteUrl is not null)
                {
                    _openSite.Content = $"Open {_siteUrl}";
                    _buttons.Children.Add(_openSite);
                }
            }
        }
    }

    private static Control BuildNotConnected()
    {
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*"), ColumnSpacing = 18 };
        var icon = Icon(Icons.Server, 22);
        icon.Foreground = Solid(Brand);
        grid.Children.Add(new Border
        {
            Width = 46,
            Height = 46,
            CornerRadius = new CornerRadius(12),
            VerticalAlignment = VerticalAlignment.Top,
            Background = Solid(Color.FromArgb(0x26, Brand.R, Brand.G, Brand.B)),
            Child = icon
        });
        var panel = new StackPanel { Spacing = 8, MaxWidth = 620, HorizontalAlignment = HorizontalAlignment.Left };
        panel.Children.Add(Text("Not connected", 19, weight: FontWeight.SemiBold));
        panel.Children.Add(Text("Log in to the server first. The login is used for everything (installing, the addons and the tools) " +
                                "and stays open until you close the program.", 13, "Pro.Muted"));
        Grid.SetColumn(panel, 1);
        grid.Children.Add(panel);
        return grid;
    }

    private void RenderStepper()
    {
        _stepper.Children.Clear();
        _stepper.ColumnDefinitions.Clear();
        var titles = (_hasKeyStep ? [(Title: "SSH key", Caption: "authorized_keys")] : Array.Empty<(string Title, string Caption)>())
            .Concat(_installSteps.Select(s => (s.Title, s.Caption)))
            .Append((Title: _finishTitle, Caption: _finishCaption))
            .ToArray();
        // Without a login nothing has started yet.
        int index = Connection is null && !IsBusy ? -1 : _index;
        for (int i = 0; i < titles.Length; i++)
        {
            bool done = i < index;
            bool current = i == index;
            var number = new Border
            {
                Width = 30,
                Height = 30,
                CornerRadius = new CornerRadius(15),
                VerticalAlignment = VerticalAlignment.Center,
                Child = done
                    ? Icon(Icons.Check, 15).Bind(PathIcon.ForegroundProperty, "Pro.SuccessText")
                    : new TextBlock
                    {
                        Text = (i + 1).ToString(),
                        FontSize = 13,
                        FontWeight = FontWeight.SemiBold,
                        HorizontalAlignment = HorizontalAlignment.Center,
                        VerticalAlignment = VerticalAlignment.Center,
                        Foreground = current ? Brushes.White : null
                    }
            };
            if (current) number.Background = Solid(Brand);
            else number.Bind(Border.BackgroundProperty, done ? "Pro.SuccessBack" : "Pro.Hover");
            if (!current && !done && number.Child is TextBlock idle) idle.Bind(TextBlock.ForegroundProperty, "Pro.Muted");

            var label = new StackPanel { Spacing = 0, VerticalAlignment = VerticalAlignment.Center };
            label.Children.Add(Text(titles[i].Title, 13, current ? "Pro.Text" : "Pro.Muted", current ? FontWeight.SemiBold : FontWeight.Normal));
            if (current || !_compactStepper) label.Children.Add(Text(titles[i].Caption, 11.5, "Pro.Subtle"));

            var item = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
            item.Children.Add(number);
            // Narrow card: only the current step shows its name; the others show a check mark or number, name on hover.
            if (_compactStepper && !current) ToolTip.SetTip(item, titles[i].Title);
            else item.Children.Add(label);
            _stepper.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));
            Grid.SetColumn(item, _stepper.ColumnDefinitions.Count - 1);
            _stepper.Children.Add(item);

            if (i < titles.Length - 1)
            {
                _stepper.ColumnDefinitions.Add(new ColumnDefinition(1, GridUnitType.Star) { MinWidth = 16, MaxWidth = 60 });
                var line = new Border { Height = 2, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(6, 0) }
                    .Bind(Border.BackgroundProperty, done ? "Pro.SuccessText" : "Pro.CardBorder");
                Grid.SetColumn(line, _stepper.ColumnDefinitions.Count - 1);
                _stepper.Children.Add(line);
            }
        }
    }

    private void UpdateKeyButtons()
    {
        _buttons.Children.Clear();
        if (IsBusy) return;
        SetPrimary(_next, true);
        switch (_keyOutcome)
        {
            case null:
                _buttons.Children.Add(_leave);
                AddInstallOrSkip(_keyAlreadyInstalled ? "Install another key" : "Install key", _keyAlreadyInstalled);
                return;
            case KeyStepOutcome.Installed:
                _buttons.Children.Add(_leave);
                _buttons.Children.Add(_anotherKey);
                _next.Content = $"Next: {_installSteps[0].Title}";
                break;
            case KeyStepOutcome.Failed:
                _buttons.Children.Add(_leave);
                _next.Content = "Try again";
                break;
            case KeyStepOutcome.Aborted:
                _buttons.Children.Add(_abort);
                _next.Content = "Start over";
                break;
        }
        _buttons.Children.Add(_next);
    }

    private async Task KeyStepNextAsync()
    {
        if (Connection is not { } connection)
        {
            Render();
            return;
        }
        if (_keyOutcome is KeyStepOutcome.Installed)
        {
            await EnterInstallStepAsync(0);
            return;
        }
        if (_keyOutcome is not null)
        {
            // "Try again" or "Start over": back to the choices, with a fresh look at the server.
            await EnterKeyStepAsync();
            return;
        }

        string? error = _keyStep.Validate();
        if (error is not null)
        {
            _validation.Text = error;
            return;
        }
        if (TopLevel.GetTopLevel(View) is not Window owner) return;

        _validation.Text = "";
        IsBusy = true;
        UpdateKeyButtons();
        StateChanged?.Invoke();
        try
        {
            _keyOutcome = await _keyStep.RunAsync(connection, owner);
            if (_keyOutcome == KeyStepOutcome.Aborted) SetStatus("Installation aborted. Nothing was changed on the server.");
        }
        finally
        {
            IsBusy = false;
            RenderStepper();
            UpdateKeyButtons();
            StateChanged?.Invoke();
        }
    }

    // Install and Skip side by side; the one that fits the check result is highlighted, on the right.
    private void AddInstallOrSkip(string installText, bool alreadyInstalled)
    {
        _next.Content = installText;
        _skip.Content = alreadyInstalled ? "Skip (already installed)" : "Skip";
        SetPrimary(_next, !alreadyInstalled);
        SetPrimary(_skip, alreadyInstalled);
        if (alreadyInstalled)
        {
            _buttons.Children.Add(_next);
            _buttons.Children.Add(_skip);
        }
        else
        {
            _buttons.Children.Add(_skip);
            _buttons.Children.Add(_next);
        }
    }

    private static void SetPrimary(Button button, bool primary)
    {
        button.Classes.Set("primary", primary);
        button.Classes.Set("secondary", !primary);
    }

    private async Task EnterKeyStepAsync()
    {
        if (Connection is not { } connection) return;
        _index = KeyIndex;
        _keyOutcome = null;
        _keyStep.ShowOptions(connection.Login.Host);
        await CheckAsync("Checking the installed SSH keys ...", () => _keyStep.DetectAsync(connection), found => _keyAlreadyInstalled = found);
    }

    private async Task EnterInstallStepAsync(int i)
    {
        if (Connection is not { } connection) return;
        InstallStep step = _installSteps[i];
        _index = FirstInstallIndex + i;
        _installOutcomes[i] = null;
        step.ShowIntro();
        await CheckAsync($"Checking {step.Title} on the server ...", () => step.DetectAsync(connection), found => _installAlreadyDone[i] = found);
    }

    // Title plus caption when another step shares the title (Octane clone / build).
    private string StepName(int i) =>
        _installSteps.Count(s => s.Title == _installSteps[i].Title) > 1 ? $"{_installSteps[i].Title} ({_installSteps[i].Caption})" : _installSteps[i].Title;

    private async Task EnterFinishAsync()
    {
        if (Connection is not { } connection) return;
        _index = FinishIndex;
        _finishView = null;
        IsBusy = true;
        Render();
        SetStatus("Collecting the summary ...");
        try
        {
            WebAccessState web = await Task.Run(() => WebAccessInstaller.InspectAsync(connection));
            _siteUrl = OpenUrl?.Invoke() ?? web.Configured?.Url;
            string host = connection.Login.Host;
            string? ppk = Directory.Exists(ClientConfiguration.KeysDirectory(host))
                ? Directory.GetFiles(ClientConfiguration.KeysDirectory(host), "*.ppk").OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault()
                : null;

            var steps = new List<(string, StepSummary)>();
            if (_hasKeyStep)
                steps.Add(("SSH key", _keyOutcome == KeyStepOutcome.Installed ? StepSummary.Done
                    : _keyAlreadyInstalled ? StepSummary.AlreadyInstalled
                    : _keyOutcome == KeyStepOutcome.Failed ? StepSummary.Failed : StepSummary.Skipped));
            for (int i = 0; i < _installSteps.Length; i++)
                steps.Add((StepName(i), _installOutcomes[i] switch
                {
                    StepOutcome.Done => StepSummary.Done,
                    _ when _installFailed[i] => StepSummary.Failed,
                    _ when _installAlreadyDone[i] => StepSummary.AlreadyInstalled,
                    StepOutcome.Skipped => StepSummary.Skipped,
                    _ => StepSummary.NotRun
                }));
            _finishView = _finishPage(host, connection.Login.Port, web.Configured, ppk, steps);
            SetStatus("Installation completed.");
        }
        catch (Exception ex)
        {
            _finishView = Text($"Collecting the summary failed: {(ex is ServerConnectionException ? ex.Message : $"{ex.GetType().Name}: {ex.Message}")}", 13, "Pro.ErrorText");
            SetStatus("Collecting the summary failed.");
        }
        finally
        {
            IsBusy = false;
            Render();
        }
    }

    // Runs the check with the buttons hidden, then renders the step with the right buttons.
    private async Task CheckAsync(string status, Func<Task<bool>> check, Action<bool> store)
    {
        IsBusy = true;
        Render();
        SetStatus(status);
        bool found = false;
        try
        {
            found = await check();
        }
        finally
        {
            // Stored before Render, which picks the buttons from it.
            store(found);
            IsBusy = false;
            Render();
            SetStatus("Ready.");
        }
    }

    private void UpdateInstallButtons()
    {
        _buttons.Children.Clear();
        if (IsBusy) return;
        int i = InstallStepIndex;
        InstallStep step = _installSteps[i];
        bool hasNext = i + 1 < _installSteps.Length;
        _continue.Content = hasNext ? $"Next: {_installSteps[i + 1].Title}" : "Finish";
        SetPrimary(_next, true);
        _buttons.Children.Add(_installOutcomes[i] == StepOutcome.Aborted ? _abort : _leave);
        switch (_installOutcomes[i])
        {
            case null:
                bool done = _installAlreadyDone[i];
                AddInstallOrSkip(done ? step.RerunLabel : step.InstallLabel, done);
                break;
            case StepOutcome.Skipped:
                // Only the last step stays on screen when skipped; the user can still change their mind.
                _next.Content = $"{step.InstallLabel} anyway";
                SetPrimary(_next, false);
                _buttons.Children.Add(_next);
                break;
            case StepOutcome.Done:
                _buttons.Children.Add(_continue);
                break;
            case StepOutcome.Failed:
                _skip.Content = "Skip";
                SetPrimary(_skip, false);
                _buttons.Children.Add(_skip);
                _next.Content = "Try again";
                _buttons.Children.Add(_next);
                break;
            case StepOutcome.Aborted:
                _next.Content = "Start over";
                _buttons.Children.Add(_next);
                break;
        }
    }

    private async Task InstallStepNextAsync()
    {
        int i = InstallStepIndex;
        if (Connection is not { } connection)
        {
            Render();
            return;
        }
        if (_installOutcomes[i] is StepOutcome.Aborted)
        {
            await StartAsync();
            return;
        }
        if (TopLevel.GetTopLevel(View) is not Window owner) return;
        if (_installSteps[i].Validate() is { } problem)
        {
            _validation.Text = problem;
            return;
        }
        _validation.Text = "";

        IsBusy = true;
        UpdateInstallButtons();
        StateChanged?.Invoke();
        try
        {
            _installOutcomes[i] = await _installSteps[i].RunAsync(connection, owner);
            _installFailed[i] = _installOutcomes[i] == StepOutcome.Failed;
            if (_installOutcomes[i] == StepOutcome.Aborted) SetStatus("Installation aborted. Nothing was changed on the server.");
        }
        finally
        {
            IsBusy = false;
            RenderStepper();
            UpdateInstallButtons();
            StateChanged?.Invoke();
        }
    }

    private void SetStatus(string message)
    {
        StatusMessage = message;
        StateChanged?.Invoke();
    }
}
