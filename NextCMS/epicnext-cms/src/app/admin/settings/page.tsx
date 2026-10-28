import { asc } from "drizzle-orm";
import { Settings } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { db, WebsiteSetting } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import {
	isSecretSettingKey,
	SECRET_PLACEHOLDER,
} from "@/lib/services/setting-secrets";
import { AdvancedSettingsPanel } from "./advanced-settings-panel";
import { FIELD_DEFAULTS, MANAGED_SETTING_KEYS } from "./cms-settings-config";
import { CmsSettingsForm } from "./cms-settings-form";

export const metadata = { title: "CMS Settings" };

export default async function AdminSettings() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SETTINGS_VIEW, session.user.rank)) {
		redirect("/admin");
	}
	const canEdit = canAccess(
		permissions,
		PERMS.SETTINGS_EDIT,
		session.user.rank,
	);
	const t = await getTranslations("pages.admin.settings");

	let settings: (typeof WebsiteSetting.$inferSelect)[] = [];
	try {
		settings = await db
			.select()
			.from(WebsiteSetting)
			.orderBy(asc(WebsiteSetting.key));
	} catch {
		settings = [];
	}

	const dbValues = new Map(settings.map((s) => [s.key, s.value]));
	const values: Record<string, string> = Object.fromEntries(
		MANAGED_SETTING_KEYS.map((key) => [
			key,
			dbValues.get(key) ?? FIELD_DEFAULTS[key] ?? "",
		]),
	);

	const documented = settings.filter((s) => !!s.comment).length;

	return (
		<AdminPageShell icon={Settings} title={t("title")} subtitle={t("subtitle")}>
			<div className="space-y-8">
				<div className="admin-stat-row">
					<span className="admin-stat-chip">
						{t("keysInDatabase", { count: settings.length })}
					</span>
					<span className="admin-stat-chip">
						{t("managedInForm", { count: MANAGED_SETTING_KEYS.length })}
					</span>
					<span className="admin-stat-chip">
						{t("documented", { count: documented })}
					</span>
				</div>

				<CmsSettingsForm values={values} canEdit={canEdit} />

				<AdvancedSettingsPanel
					// Credentials never leave the server: a reader with only
					// SETTINGS_VIEW must not receive captcha/radio secrets in the
					// payload, and an editor sees a "keep stored value" placeholder.
					settings={settings.map((s) => ({
						key: s.key,
						value: isSecretSettingKey(s.key) ? SECRET_PLACEHOLDER : s.value,
						comment: s.comment,
						secret: isSecretSettingKey(s.key),
					}))}
					canEdit={canEdit}
				/>
			</div>
		</AdminPageShell>
	);
}
