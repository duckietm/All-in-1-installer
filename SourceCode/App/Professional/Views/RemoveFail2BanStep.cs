using Avalonia.Controls;
using AllInOneInstaller.Remote;
using static AllInOneInstaller.App.Professional.ProfessionalTheme;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>Removes fail2ban: stopped, off at boot, the installer's settings and the package removed.</summary>
public sealed class RemoveFail2BanStep : InstallStep
{
    public override string Title => "Remove Fail2Ban";
    public override string Caption => "Stop and uninstall";
    public override string InstallLabel => "Remove Fail2Ban";
    public override string RerunLabel => "Remove again";

    public RemoveFail2BanStep() : base(Icons.Shield,
        "Remove Fail2Ban",
        "SSH is no longer protected against password guessing. The firewall (ufw) and everything else stay as they are.",
        [
            "Stops fail2ban and takes it off at boot: every current ban is lifted.",
            $"Deletes {Fail2BanInstaller.ConfigFile} (the settings and the whitelist).",
            "Removes the fail2ban package (apt-get remove).",
            "With SSH keys only (no passwords) the risk is small; with password logins, keep fail2ban."
        ],
        null,
        [
            "Check the server",
            "Stop and remove fail2ban"
        ])
    {
    }

    protected override async Task<bool> DetectCoreAsync(ServerConnection connection)
    {
        Fail2BanState state = await Task.Run(() => Fail2BanInstaller.InspectAsync(connection));
        if (!state.Installed)
            Detected.Show(ResultKind.Success, "Fail2ban is not installed", "There is nothing to remove. Running this step anyway removes what may be left.");
        else
            Detected.Show(ResultKind.Info, $"Fail2ban {state.Version} {(state.Running ? "runs" : "is installed")}",
                $"{state.Banned.Count} address(es) are banned now; they are let in again.");
        return false;
    }

    protected override async Task<StepOutcome> RunCoreAsync(ServerConnection connection, Window owner)
    {
        Run.Log("> Checking the server ...");
        Fail2BanState state = await Task.Run(() => Fail2BanInstaller.InspectAsync(connection));
        Run.Log(state.Installed ? $"  fail2ban {state.Version}, {state.Banned.Count} banned" : "  fail2ban is not installed: removing what may be left");
        Run.Done(state.Installed ? state.Version ?? "installed" : "not installed");

        await Task.Run(() => Fail2BanInstaller.RemoveAsync(connection, Run.Log));
        Run.Done("removed");
        return await SucceededAsync("Fail2Ban is removed", "SSH is no longer protected by fail2ban. Addons → Fail2Ban → Install sets it up again.");
    }
}
