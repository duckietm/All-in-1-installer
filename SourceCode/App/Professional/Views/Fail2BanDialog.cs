using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>Tools → Fail2Ban: edits the whitelist and picks banned addresses to let in again. Returns null when cancelled.</summary>
public static class Fail2BanDialog
{
    public sealed record Changes(IReadOnlyList<string>? Whitelist, IReadOnlyList<string> Unban);

    public static async Task<Changes?> ShowAsync(Window owner, Fail2BanState state)
    {
        var dialog = new Window
        {
            Title = "Fail2Ban",
            Width = 600,
            SizeToContent = SizeToContent.Height,
            CanResize = false,
            WindowStartupLocation = WindowStartupLocation.CenterOwner
        };
        dialog.Bind(Window.BackgroundProperty, "Pro.Card");
        Changes? result = null;
        IReadOnlyList<string> current = state.Settings?.Whitelist ?? [];

        var whitelist = new TextBox
        {
            AcceptsReturn = true,
            TextWrapping = TextWrapping.NoWrap,
            Height = 140,
            FontFamily = new FontFamily("Consolas,Menlo,monospace"),
            Text = string.Join('\n', current),
            PlaceholderText = "One address or network per line, for example\n203.0.113.7\n192.168.1.0/24"
        };
        var addMine = new Button { Content = state.ClientIp is { } ip ? $"Add my IP ({ip})" : "Add my IP", Padding = new Thickness(12, 5), Classes = { "secondary" }, IsEnabled = state.ClientIp is not null };
        addMine.Click += (_, _) =>
        {
            string text = (whitelist.Text ?? "").TrimEnd();
            if (!Fail2BanInstaller.ParseWhitelist(text).Entries.Contains(state.ClientIp!))
                whitelist.Text = (text.Length > 0 ? text + "\n" : "") + state.ClientIp;
        };

        var banned = new StackPanel { Spacing = 4 };
        var unban = new List<(CheckBox Box, string Ip)>();
        if (state.Banned.Count == 0) banned.Children.Add(Text("No address is banned right now.", 12.5, "Pro.Subtle"));
        foreach (string address in state.Banned)
        {
            var box = new CheckBox { Content = address == state.ClientIp ? $"{address} (this computer)" : address };
            unban.Add((box, address));
            banned.Children.Add(box);
        }

        TextBlock error = Text("", 12.5, "Pro.ErrorText");
        var save = new Button { Content = "Save", Padding = new Thickness(22, 9), Classes = { "primary" } };
        var cancel = new Button { Content = "Cancel", Padding = new Thickness(18, 9), Classes = { "secondary" } };
        save.Click += (_, _) =>
        {
            (List<string> entries, string? problem) = Fail2BanInstaller.ParseWhitelist(whitelist.Text ?? "");
            if (problem is not null) { error.Text = problem; return; }
            bool changed = !entries.SequenceEqual(current, StringComparer.OrdinalIgnoreCase) || !state.Configured;
            List<string> picked = unban.Where(u => u.Box.IsChecked == true).Select(u => u.Ip).ToList();
            if (!changed && picked.Count == 0) { dialog.Close(); return; }
            result = new Changes(changed ? entries : null, picked);
            dialog.Close();
        };
        cancel.Click += (_, _) => dialog.Close();

        var panel = new StackPanel { Spacing = 10, Margin = new Thickness(26, 24) };
        panel.Children.Add(Title("Whitelist and bans", 20));
        string ports = state.SshPorts.Count > 0 ? string.Join(", ", state.SshPorts) : "22";
        panel.Children.Add(Text($"Fail2ban {state.Version} protects SSH (port {ports}): {state.Banned.Count} banned now, {state.TotalBanned} since its last restart.", 13));
        panel.Children.Add(Text("Whitelist (never banned)", 12, "Pro.Muted", FontWeight.SemiBold));
        panel.Children.Add(whitelist);
        panel.Children.Add(Text("IPv4, IPv6, or a network such as 192.168.1.0/24. Text after # is a comment.", 12, "Pro.Subtle"));
        addMine.HorizontalAlignment = HorizontalAlignment.Left;
        panel.Children.Add(addMine);
        panel.Children.Add(Text("Banned now: tick to let in again", 12, "Pro.Muted", FontWeight.SemiBold));
        panel.Children.Add(new ScrollViewer { MaxHeight = 180, Content = banned });
        panel.Children.Add(error);
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        buttons.Children.Add(cancel);
        buttons.Children.Add(save);
        panel.Children.Add(buttons);
        dialog.Content = panel;
        await dialog.ShowDialog(owner);
        return result;
    }
}
