using Avalonia;
using Avalonia.Controls;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>Removes CrowdSec: the bouncer out of Traefik first, then the engine; its data only when asked.</summary>
public sealed class RemoveCrowdSecStep : InstallStep
{
    private readonly CheckBox _deleteData = new() { Content = $"Also delete CrowdSec's data and enrollment ({CrowdSecInstaller.Directory}): installing again then needs a new key" };

    /// <summary>Set after a run, for the finished page.</summary>
    public bool DataDeleted { get; private set; }

    public override string Title => "Remove CrowdSec";
    public override string Caption => "Bouncer and engine";
    public override string InstallLabel => "Remove CrowdSec";
    public override string RerunLabel => "Remove again";

    public RemoveCrowdSecStep() : base(Icons.Shield,
        "Remove CrowdSec",
        "Traefik no longer checks visitors with CrowdSec, and every ban is lifted. The hotel, Traefik and the firewall keep running as they are.",
        [
            $"Takes the bouncer out of Traefik ({CrowdSecInstaller.MiddlewareFile} and the plugin) and restarts Traefik (players are disconnected for a moment).",
            "Stops and removes the CrowdSec container (docker compose down).",
            $"Keeps {CrowdSecInstaller.Directory} (its data and the enrollment) unless you tick the box below: installing again then needs no new key.",
            "Remove the engine from your CrowdSec console yourself when you no longer need it (Security Engines → the engine → Remove)."
        ],
        null,
        [
            "Check the server",
            "Remove the bouncer and CrowdSec"
        ])
    {
    }

    protected override Control BuildOptions()
    {
        var panel = new StackPanel { Spacing = 6, Margin = new Thickness(0, 8, 0, 0) };
        panel.Children.Add(_deleteData);
        return panel;
    }

    protected override async Task<bool> DetectCoreAsync(ServerConnection connection)
    {
        CrowdSecState state = await Task.Run(() => CrowdSecInstaller.InspectAsync(connection));
        if (!state.Installed && !state.BouncerConfigured)
            Detected.Show(ResultKind.Success, "CrowdSec is not installed", "There is nothing to remove. Running this step anyway removes what may be left.");
        else
            Detected.Show(ResultKind.Info, $"CrowdSec {state.Version} {(state.Running ? "runs" : "is installed")}",
                $"{state.Banned.Count} address(es) banned by this server now; after this step nobody is blocked by CrowdSec.");
        return false;
    }

    protected override async Task<StepOutcome> RunCoreAsync(ServerConnection connection, Window owner)
    {
        Run.Log("> Checking the server ...");
        CrowdSecState state = await Task.Run(() => CrowdSecInstaller.InspectAsync(connection));
        bool delete = _deleteData.IsChecked == true;
        Run.Log(state.Installed ? $"  CrowdSec {state.Version}, bouncer in Traefik: {(state.BouncerConfigured ? "yes" : "no")}" : "  CrowdSec is not set up: removing what may be left");
        Run.Done(state.Installed ? state.Version ?? "installed" : "not installed");

        await Task.Run(() => CrowdSecInstaller.RemoveAsync(connection, state.Site, delete, Run.Log));
        Run.Done(delete ? "removed, data deleted" : "removed, data kept");
        DataDeleted = delete;
        return await SucceededAsync("CrowdSec is removed",
            "Traefik no longer checks visitors with CrowdSec. " +
            (delete ? $"{CrowdSecInstaller.Directory} is deleted." : $"Its data and enrollment stay in {CrowdSecInstaller.Directory}: Install CrowdSec brings it back without a new key.") +
            " Remove the engine from your CrowdSec console when you no longer need it.");
    }
}
