using System.Collections.Concurrent;
using Avalonia;
using Avalonia.Collections;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>
/// Live logs of the server: the emulator, NGINX, Traefik and the firewall, followed over the login while the page is
/// on screen. Leaving the page stops the follower on the server.
/// </summary>
public sealed class DebugView : Grid
{
    private const int MaxLines = 5000;

    /// <summary>A log to follow: the button's name, what it shows, what it follows, and the command (it never ends).</summary>
    private sealed record Source(string Name, string Description, string Follows, string Command);

    private static readonly Source[] Sources =
    [
        new("Emulator", $"{EmulatorInstaller.LogDirectory}/emulator.log: what Polaris prints (startup, errors, wired, players)",
            $"{EmulatorInstaller.LogDirectory}/emulator.log",
            $"tail -n 200 -F {EmulatorInstaller.LogDirectory}/emulator.log"),
        new("NGINX errors", $"{HotelSite.LogDirectory}/error.log and /var/log/nginx/error.log",
            $"{HotelSite.LogDirectory}/error.log, /var/log/nginx/error.log",
            $"tail -n 100 -F {HotelSite.LogDirectory}/error.log /var/log/nginx/error.log"),
        new("NGINX access", $"{HotelSite.LogDirectory}/access.log: every request that reaches the hotel site",
            $"{HotelSite.LogDirectory}/access.log",
            $"tail -n 100 -F {HotelSite.LogDirectory}/access.log"),
        new("Traefik", "docker logs of the traefik container: certificates, routing and connection errors",
            "docker logs traefik",
            "if command -v docker >/dev/null 2>&1 && docker inspect traefik >/dev/null 2>&1; then docker logs -f --tail 200 traefik; " +
            "else echo 'There is no traefik container on this server (Web access step).'; sleep infinity; fi"),
        new("Firewall", $"{HardenInstaller.UfwLog}: connections ufw blocked (BLOCK) or let through and logged",
            $"{HardenInstaller.UfwLog} (or the journal without rsyslog)",
            $"if [ -f {HardenInstaller.UfwLog} ]; then tail -n 200 -F {HardenInstaller.UfwLog}; " +
            "else echo 'No ufw.log (no rsyslog): following the journal instead.'; journalctl -k -f -n 200 -o short-iso | grep --line-buffered UFW; fi")
    ];

    private readonly Func<ServerConnection?> _connection;
    private readonly AvaloniaList<string> _shown = [];
    private readonly List<string> _all = [];
    private readonly ConcurrentQueue<string> _incoming = new();
    private readonly LogView _log;
    private readonly DispatcherTimer _flush = new() { Interval = TimeSpan.FromMilliseconds(200) };
    private readonly TextBlock _title = Text("", 13, weight: FontWeight.SemiBold);
    private readonly TextBlock _description = Text("", 12, "Pro.Muted");
    private readonly TextBlock _state = Text("", 12, "Pro.Muted");
    private readonly TextBox _filter = new() { PlaceholderText = "Filter: only lines with this text", MinWidth = 260, FontSize = 12.5 };
    private readonly Button _pause = new() { Content = "Pause", Padding = new Thickness(14, 7), Classes = { "secondary" } };
    private readonly List<Button> _sourceButtons = [];
    private Source _source = Sources[0];
    private CancellationTokenSource? _following;
    private bool _paused;

    public DebugView(Func<ServerConnection?> connection)
    {
        _connection = connection;
        RowDefinitions = new RowDefinitions("Auto,Auto,*,Auto");
        RowSpacing = 10;
        Margin = new Thickness(32, 0, 32, 18);

        var sources = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (Source source in Sources)
        {
            var button = new Button { Content = source.Name, Padding = new Thickness(16, 8), Margin = new Thickness(0, 0, 8, 0), Tag = source };
            button.Click += (_, _) => Follow(source);
            _sourceButtons.Add(button);
            sources.Children.Add(button);
        }
        Children.Add(sources);

        var bar = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), ColumnSpacing = 12 };
        var heading = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        _title.TextTrimming = TextTrimming.CharacterEllipsis;
        heading.Children.Add(_title);
        heading.Children.Add(_description);
        bar.Children.Add(heading);
        var tools = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        _filter.TextChanged += (_, _) => Refilter();
        tools.Children.Add(_filter);
        _pause.Click += (_, _) => SetPaused(!_paused);
        tools.Children.Add(_pause);
        var clear = new Button { Content = "Clear", Padding = new Thickness(14, 7), Classes = { "secondary" } };
        clear.Click += (_, _) =>
        {
            _all.Clear();
            _shown.Clear();
        };
        tools.Children.Add(clear);
        var restart = new Button { Content = "Restart", Padding = new Thickness(14, 7), Classes = { "secondary" } };
        ToolTip.SetTip(restart, "Follow this log again from its last lines, for example after the connection was lost.");
        restart.Click += (_, _) => Follow(_source);
        tools.Children.Add(restart);
        Grid.SetColumn(tools, 1);
        bar.Children.Add(tools);
        Grid.SetRow(bar, 1);
        Children.Add(bar);

        _log = new LogView(_shown);
        Grid.SetRow(_log, 2);
        Children.Add(_log);

        _state.TextWrapping = TextWrapping.Wrap;
        Grid.SetRow(_state, 3);
        Children.Add(_state);

        _flush.Tick += (_, _) => Flush();
        // Only while the page is on screen: leaving it stops the follower on the server.
        AttachedToVisualTree += (_, _) => Follow(_source);
        DetachedFromVisualTree += (_, _) => Stop();
    }

    private void Follow(Source source)
    {
        Stop();
        _source = source;
        foreach (Button button in _sourceButtons)
        {
            bool selected = ReferenceEquals(button.Tag, source);
            button.Classes.Set("primary", selected);
            button.Classes.Set("secondary", !selected);
        }
        _title.Text = source.Name;
        _description.Text = source.Description;
        _all.Clear();
        _shown.Clear();
        _incoming.Clear();
        SetPaused(false);
        if (_connection() is not { } connection)
        {
            ShowState("Not connected: log in to follow the logs.", error: true);
            return;
        }

        var following = new CancellationTokenSource();
        _following = following;
        _flush.Start();
        ShowState($"Live: {source.Follows} on {connection.Login.Host}, the newest lines at the bottom.");
        _ = Task.Run(async () =>
        {
            string? ended = null;
            try
            {
                await connection.FollowAsRootAsync(ServerConnection.FollowScript(source.Command), line => _incoming.Enqueue(line), following.Token);
                ended = "The log stopped on the server.";
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception ex)
            {
                ended = $"Stopped: {ex.Message}";
            }
            if (ended is not null)
                await Dispatcher.UIThread.InvokeAsync(() =>
                {
                    if (_following != following) return;
                    Flush();
                    ShowState(ended + " Restart follows it again.", error: true);
                });
        });
    }

    /// <summary>Stops following (the follower on the server ends with the SSH channel).</summary>
    public void Stop()
    {
        _following?.Cancel();
        _following?.Dispose();
        _following = null;
        _flush.Stop();
    }

    // Lines arrive on the SSH thread; they are added in batches, five times a second.
    private void Flush()
    {
        if (_incoming.IsEmpty) return;
        var batch = new List<string>();
        while (_incoming.TryDequeue(out string? line)) batch.Add(line);
        _all.AddRange(batch);
        if (_all.Count > MaxLines) _all.RemoveRange(0, _all.Count - MaxLines);
        if (_paused) return;
        string filter = _filter.Text ?? "";
        IEnumerable<string> visible = filter.Length == 0 ? batch : batch.Where(l => l.Contains(filter, StringComparison.OrdinalIgnoreCase));
        _shown.AddRange(visible);
        if (_shown.Count > MaxLines) _shown.RemoveRange(0, _shown.Count - MaxLines);
        _log.FollowOutput();
    }

    private void Refilter()
    {
        string filter = _filter.Text ?? "";
        _shown.Clear();
        _shown.AddRange(filter.Length == 0 ? _all : _all.Where(l => l.Contains(filter, StringComparison.OrdinalIgnoreCase)));
        _log.FollowOutput();
    }

    // Paused: lines are still collected, but the view holds still until Resume.
    private void SetPaused(bool paused)
    {
        _paused = paused;
        _pause.Content = paused ? "Resume" : "Pause";
        if (!paused) Refilter();
    }

    private void ShowState(string text, bool error = false)
    {
        _state.Text = text;
        _state.Bind(TextBlock.ForegroundProperty, error ? "Pro.WarningText" : "Pro.Muted");
    }
}
