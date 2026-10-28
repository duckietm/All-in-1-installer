import { inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { saveMaintenance } from "@/actions/admin-maintenance";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { db, WebsiteSetting } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

const KEYS = [
	"maintenance_enabled",
	"maintenance_message",
	"min_maintenance_login_rank",
] as const;

export default async function AdminMaintenance() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SETTINGS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.maintenance");

	let rows: { key: string; value: string }[] = [];
	try {
		rows = await db
			.select({ key: WebsiteSetting.key, value: WebsiteSetting.value })
			.from(WebsiteSetting)
			.where(inArray(WebsiteSetting.key, [...KEYS]));
	} catch {
		rows = [];
	}

	const byKey = new Map(rows.map((r) => [r.key, r.value]));

	const enabledRaw = byKey.get("maintenance_enabled") ?? "0";
	const enabled = enabledRaw === "1" || enabledRaw.toLowerCase() === "true";
	const message = byKey.get("maintenance_message") ?? "";
	const minRankRaw = byKey.get("min_maintenance_login_rank") ?? "5";
	const minRank = Number.parseInt(minRankRaw, 10);
	const minRankValue = Number.isFinite(minRank) ? minRank : 5;

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard
					label={t("maintenance")}
					value={enabled ? t("enabled") : t("disabled")}
					state={enabled ? "danger" : "ok"}
					hint={enabled ? t("hotelLockedDown") : t("hotelOpen")}
					icon={enabled ? "🚧" : "🟢"}
				/>
				<StatusCard
					label={t("minLoginRank")}
					value={minRankValue}
					hint={t("duringMaintenance")}
					icon="🛡️"
				/>
				<StatusCard
					label={t("splashMessage")}
					value={message ? t("set") : t("empty")}
					state={message ? "ok" : "neutral"}
					icon="💬"
				/>
			</div>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("currentState")}</h2>
				<div className="admin-card flex items-center gap-3">
					<span
						className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${enabled ? "bg-[var(--admin-error-subtle)] text-[var(--admin-text)]" : "bg-[var(--admin-success-subtle)] text-[var(--admin-text)]"}`}
					>
						{enabled ? t("enabled") : t("disabled")}
					</span>
					<div>
						<strong>
							{t("maintenanceCurrently", {
								status: enabled ? t("enabled") : t("disabled"),
							})}
						</strong>
						<p className="text-xs theme-text-muted dark:theme-text-muted mt-1 m-0">
							{enabled
								? t("onlyRankCanLogin", { rank: minRankValue })
								: t("hotelOpenToEveryone")}
						</p>
					</div>
				</div>
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("settings")}</h2>
				<form action={saveMaintenance} className="admin-card">
					<label htmlFor="mt-enabled" className="flex items-center gap-2 mb-4">
						<input
							id="mt-enabled"
							type="checkbox"
							name="enabled"
							value="1"
							defaultChecked={enabled}
							className="w-auto"
						/>
						<span>{t("enableMaintenance")}</span>
					</label>

					<div className="mb-4 max-w-[220px]">
						<label
							htmlFor="mt-min-rank"
							className="text-sm theme-text-muted dark:theme-text-muted block mb-1"
						>
							{t("minLoginRankLabel")}
						</label>
						<input
							id="mt-min-rank"
							type="number"
							name="min_rank"
							min={0}
							step={1}
							defaultValue={minRankValue}
							className="w-full"
						/>
					</div>

					<div className="mb-4">
						<label
							htmlFor="mt-message"
							className="text-sm theme-text-muted dark:theme-text-muted block mb-1"
						>
							{t("maintenanceMessageLabel")}
						</label>
						<textarea
							id="mt-message"
							name="message"
							rows={8}
							defaultValue={message}
							placeholder={t("maintenanceMessagePlaceholder")}
							className="w-full resize-y"
						/>
					</div>

					<Button type="submit" variant="default">
						{t("saveChanges")}
					</Button>
				</form>
			</section>
		</main>
	);
}
