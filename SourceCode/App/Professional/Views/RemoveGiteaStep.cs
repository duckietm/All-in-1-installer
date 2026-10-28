using Avalonia;
using Avalonia.Controls;
using AllInOneInstaller.Configuration;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>Removes Gitea: the container, its network and the Traefik route; the data only when asked.</summary>
public sealed class RemoveGiteaStep : InstallStep
{
    private readonly CheckBox _deleteData = new() { Content = $"Also delete the repositories, accounts and settings ({GiteaInstaller.Directory}): this cannot be undone" };

    /// <summary>Set after a run, for the finished page.</summary>
    public string? RemovedDomain { get; private set; }
    public bool DataDeleted { get; private set; }

    public override string Title => "Remove Gitea";
    public override string Caption => "Container and route";
    public override string InstallLabel => "Remove Gitea";
    public override string RerunLabel => "Remove again";

    public RemoveGiteaStep() : base(Icons.Git,
        "Remove Gitea",
        "Gitea stops and is no longer reachable on its domain. The hotel, Traefik and NGINX keep running as they are.",
        [
            "Stops and removes the Gitea container and its Docker network (docker compose down).",
            $"Removes its Traefik route ({GiteaInstaller.RouteFile}): Traefik no longer answers for Gitea's domain, and its port is free again.",
            $"Keeps {GiteaInstaller.Directory} (the repositories, accounts and settings) unless you tick the box below: installing Gitea again then brings everything back.",
            "Remove the domain's A record from your DNS yourself when you no longer need it."
        ],
        null,
        [
            "Check the server",
            "Stop Gitea and remove its route",
            "Check that the domain is gone"
        ])
    {
    }

    protected override Control BuildOptions()
    {
        var panel = new StackPanel { Spacing = 6, Margin = new Thickness(0, 8, 0, 0) };
        panel.Children.Add(_deleteData);
        panel.Children.Add(Text("Without the box, the data stays on the server: download it first if you want a copy elsewhere (SFTP, for example WinSCP).", 12, "Pro.Subtle"));
        return panel;
    }

    protected override async Task<bool> DetectCoreAsync(ServerConnection connection)
    {
        GiteaState state = await Task.Run(() => GiteaInstaller.InspectAsync(connection));
        if (state.Domain is null && !state.Running)
        {
            Detected.Show(ResultKind.Success, "Gitea is not installed", "There is nothing to remove. Running this step anyway removes what may be left (container, route).");
            // Not "installed": a removal page shows its own button, never "Skip (already installed)".
            return false;
        }
        Detected.Show(ResultKind.Info, $"Gitea {state.Version} runs on {state.Domain}",
            $"After this step {state.Domain} no longer reaches Gitea.");
        return false;
    }

    protected override async Task<StepOutcome> RunCoreAsync(ServerConnection connection, Window owner)
    {
        Run.Log("> Checking the server ...");
        GiteaState state = await Task.Run(() => GiteaInstaller.InspectAsync(connection));
        bool delete = _deleteData.IsChecked == true;
        Run.Log(state.Domain is null ? "  Gitea is not set up: removing what may be left" : $"  Gitea {state.Version} on {state.Domain} (port {state.Port})");
        Run.Done(state.Domain ?? "not installed");

        await Task.Run(() => GiteaInstaller.RemoveAsync(connection, state.Domain, state.Site?.Https ?? true, delete, Run.Log));
        Run.Done(delete ? "removed, data deleted" : "removed, data kept");

        // The admin's saved password belongs to the deleted data.
        string login = GiteaStep.GiteaLoginPath(connection.Login.Host);
        if (delete && File.Exists(login)) File.Delete(login);
        Run.Done(state.Domain ?? "-");

        RemovedDomain = state.Domain;
        DataDeleted = delete;
        return await SucceededAsync("Gitea is removed",
            (state.Domain is null ? "" : $"{state.Domain} no longer reaches Gitea. ") +
            (delete ? $"{GiteaInstaller.Directory} is deleted." : $"Its repositories, accounts and settings stay in {GiteaInstaller.Directory}: Install Gitea brings them back.") +
            " Remove the domain's A record when you no longer need it.");
    }
}
