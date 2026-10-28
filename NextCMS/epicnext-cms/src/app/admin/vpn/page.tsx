import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { saveVpn } from "@/actions/admin-vpn";
import { StatusCard } from "@/components/admin/dashboard";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";

export const metadata = { title: "VPN" };

const PROVIDERS: { value: string; label: string }[] = [
	{ value: "none", label: "None (disabled)" },
	{ value: "proxycheck", label: "proxycheck.io" },
	{ value: "ipqualityscore", label: "IPQualityScore" },
];

export default async function AdminVpn({
	searchParams,
}: {
	searchParams: Promise<{ saved?: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SETTINGS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const sp = await searchParams;
	const t = await getTranslations("pages.admin.vpn");

	// Read current values (graceful fallbacks via siteSettings / DEFAULTS).
	const enabled = await siteSettings.getBool("vpn_block_enabled", false);
	const provider = (await siteSettings.get("vpn_provider", "none")) ?? "none";
	const apiKey = (await siteSettings.get("vpn_api_key", "")) ?? "";
	const blockMessage =
		(await siteSettings.get(
			"vpn_block_message",
			"Registrations from VPNs or proxies are not allowed.",
		)) ?? "";

	return (
		<main>
			<section className="mt-6">
				{sp.saved ? (
					<p className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-success-subtle)] text-[var(--admin-text)]">
						{t("settingsSaved")}
					</p>
				) : null}

				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
					<StatusCard
						label={t("protection")}
						value={enabled ? t("on") : t("off")}
						state={enabled ? "ok" : "danger"}
						hint={enabled ? t("providerLabel", { provider }) : t("notScreened")}
						icon="🛡️"
					/>
				</div>
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("settings")}</h2>
				<form action={saveVpn} className="admin-card">
					<div style={{ marginBottom: "1rem" }}>
						<label
							style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}
						>
							<input
								type="checkbox"
								name="vpn_block_enabled"
								value="1"
								defaultChecked={enabled}
							/>
							<span style={{ fontWeight: 700 }}>{t("blockOnDetect")}</span>
						</label>
					</div>

					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<label
								htmlFor="vpn_provider"
								style={{
									display: "block",
									fontWeight: 700,
									fontSize: "0.85rem",
								}}
							>
								{t("provider")}
							</label>
							<select
								id="vpn_provider"
								name="vpn_provider"
								defaultValue={provider}
								style={{ width: "100%" }}
							>
								{PROVIDERS.map((p) => (
									<option key={p.value} value={p.value}>
										{p.label}
									</option>
								))}
							</select>
							<p
								className="text-xs theme-text-muted dark:theme-text-muted"
								style={{ margin: "0.2rem 0 0" }}
							>
								{t("providerHint")}
							</p>
						</div>

						<div>
							<label
								htmlFor="vpn_api_key"
								style={{
									display: "block",
									fontWeight: 700,
									fontSize: "0.85rem",
								}}
							>
								{t("apiKey")}
							</label>
							<input
								id="vpn_api_key"
								name="vpn_api_key"
								defaultValue={apiKey}
								autoComplete="off"
								placeholder={t("apiKeyPlaceholder")}
								style={{ width: "100%" }}
							/>
							<p
								className="text-xs theme-text-muted dark:theme-text-muted"
								style={{ margin: "0.2rem 0 0" }}
							>
								{t("apiKeyHint")}
							</p>
						</div>
					</div>

					<div style={{ marginTop: "1rem" }}>
						<label
							htmlFor="vpn_block_message"
							style={{ display: "block", fontWeight: 700, fontSize: "0.85rem" }}
						>
							{t("blockMessage")}
						</label>
						<input
							id="vpn_block_message"
							name="vpn_block_message"
							defaultValue={blockMessage}
							placeholder={t("blockMessagePlaceholder")}
							style={{ width: "100%" }}
						/>
						<p
							className="text-xs theme-text-muted dark:theme-text-muted"
							style={{ margin: "0.2rem 0 0" }}
						>
							{t("blockMessageHint")}
						</p>
					</div>

					<div
						style={{
							marginTop: "1rem",
							display: "flex",
							justifyContent: "flex-end",
						}}
					>
						<Button type="submit" variant="default">
							{t("save")}
						</Button>
					</div>
				</form>
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("rawIpTitle")}</h2>
				<p className="text-xs theme-text-muted dark:theme-text-muted">
					{t.rich("rawIpDescription", {
						ipLink: (chunks) => <Link href="/admin/ip">{chunks}</Link>,
					})}
				</p>
				<Button variant="secondary" asChild>
					<Link href="/admin/ip">{t("openIpManagement")}</Link>
				</Button>
			</section>
		</main>
	);
}
