import { asc, count } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
	updateEmulatorSetting,
	updateEmulatorText,
} from "@/actions/admin-emulator";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { db, EmulatorSettings, EmulatorTexts } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

const TEXTS_LIMIT = 300;

export default async function AdminEmulator() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SETTINGS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.emulator");

	let settings: { key: string; value: string }[] = [];
	try {
		settings = await db
			.select({ key: EmulatorSettings.key, value: EmulatorSettings.value })
			.from(EmulatorSettings)
			.orderBy(asc(EmulatorSettings.key));
	} catch {
		settings = [];
	}

	let texts: { key: string; value: string }[] = [];
	let textsCount = 0;
	try {
		const [row] = await db.select({ total: count() }).from(EmulatorTexts);
		textsCount = Number(row?.total ?? 0);
	} catch {
		textsCount = 0;
	}
	try {
		texts = await db
			.select({ key: EmulatorTexts.key, value: EmulatorTexts.value })
			.from(EmulatorTexts)
			.orderBy(asc(EmulatorTexts.key))
			.limit(TEXTS_LIMIT);
	} catch {
		texts = [];
	}

	const textsTruncated = textsCount > texts.length;

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard
					label={t("settingsKeys")}
					value={settings.length}
					icon="⚙️"
				/>
				<StatusCard label={t("textKeys")} value={textsCount} icon="🗒️" />
			</div>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("settings")}</h2>
				<p className="text-xs theme-text-muted dark:theme-text-muted mb-3">
					{t("keysCount", { count: settings.length })}
				</p>

				<form action={updateEmulatorSetting} className="admin-card mb-6">
					<h3 className="text-sm font-bold text-[var(--admin-text)] m-0 mb-3">
						{t("addOverwriteSetting")}
					</h3>
					<div className="flex gap-2 flex-wrap">
						<input name="key" placeholder={t("key")} maxLength={100} required />
						<input
							name="value"
							placeholder={t("value")}
							maxLength={512}
							className="flex-1 min-w-[200px]"
						/>
						<Button type="submit" variant="default">
							{t("save")}
						</Button>
					</div>
				</form>

				<table>
					<thead>
						<tr>
							<th className="w-[320px]">{t("colKey")}</th>
							<th>{t("colValue")}</th>
						</tr>
					</thead>
					<tbody>
						{settings.map((s) => (
							<tr key={s.key}>
								<td>
									<strong>{s.key}</strong>
								</td>
								<td>
									<form action={updateEmulatorSetting} className="flex gap-2">
										<input type="hidden" name="key" value={s.key} />
										<input
											name="value"
											defaultValue={s.value}
											maxLength={512}
											className="flex-1"
										/>
										<Button type="submit" variant="outline">
											{t("save")}
										</Button>
									</form>
								</td>
							</tr>
						))}
					</tbody>
				</table>
				{settings.length === 0 ? (
					<p className="text-xs theme-text-muted dark:theme-text-muted">
						{t("noSettings")}
					</p>
				) : null}
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("texts")}</h2>
				<p className="text-xs theme-text-muted dark:theme-text-muted mb-3">
					{t("keysCount", { count: textsCount })}
					{textsTruncated
						? ` (${t("showingFirst", { count: texts.length })})`
						: ""}
					.
				</p>

				<form action={updateEmulatorText} className="admin-card mb-6">
					<h3 className="text-sm font-bold text-[var(--admin-text)] m-0 mb-3">
						{t("addOverwriteText")}
					</h3>
					<div className="flex gap-2 flex-wrap">
						<input name="key" placeholder={t("key")} maxLength={100} required />
						<input
							name="value"
							placeholder={t("value")}
							maxLength={4096}
							className="flex-1 min-w-[200px]"
						/>
						<Button type="submit" variant="default">
							{t("save")}
						</Button>
					</div>
				</form>

				<table>
					<thead>
						<tr>
							<th className="w-[320px]">{t("colKey")}</th>
							<th>{t("colValue")}</th>
						</tr>
					</thead>
					<tbody>
						{texts.map((txt) => (
							<tr key={txt.key}>
								<td>
									<strong>{txt.key}</strong>
								</td>
								<td>
									<form action={updateEmulatorText} className="flex gap-2">
										<input type="hidden" name="key" value={txt.key} />
										<input
											name="value"
											defaultValue={txt.value}
											maxLength={4096}
											className="flex-1"
										/>
										<Button type="submit" variant="outline">
											{t("save")}
										</Button>
									</form>
								</td>
							</tr>
						))}
					</tbody>
				</table>
				{texts.length === 0 ? (
					<div className="admin-empty">{t("noTexts")}</div>
				) : null}
				{textsTruncated ? (
					<p className="muted">
						{t("truncatedHint", { shown: texts.length, total: textsCount })}
					</p>
				) : null}
			</section>
		</main>
	);
}
