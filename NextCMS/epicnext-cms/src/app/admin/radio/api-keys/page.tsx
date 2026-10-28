import { desc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import {
	createApiKey,
	deleteApiKey,
	toggleApiKey,
} from "@/actions/admin-radio-api-keys";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { db, RadioApiKeys } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

export const metadata = { title: "Radio API Keys" };

type ApiKey = {
	id: bigint;
	name: string;
	key: string;
	allowedIps: string | null;
	rateLimit: number;
	lastUsedAt: Date | null;
	expiresAt: Date | null;
	isActive: boolean;
	createdAt: Date | null;
};

function maskKey(key: string): string {
	return key.length > 8 ? `${key.slice(0, 8)}\u2026` : key;
}

export default async function AdminRadioApiKeysPage() {
	const t = await getTranslations("pages.admin.radio");

	let keys: ApiKey[] = [];
	let dbError = false;

	try {
		keys = await db
			.select({
				id: RadioApiKeys.id,
				name: RadioApiKeys.name,
				key: RadioApiKeys.key,
				allowedIps: RadioApiKeys.allowedIps,
				rateLimit: RadioApiKeys.rateLimit,
				lastUsedAt: RadioApiKeys.lastUsedAt,
				expiresAt: RadioApiKeys.expiresAt,
				isActive: RadioApiKeys.isActive,
				createdAt: RadioApiKeys.createdAt,
			})
			.from(RadioApiKeys)
			.orderBy(desc(RadioApiKeys.isActive), desc(RadioApiKeys.id))
			.limit(500)
			.catch(() => {
				dbError = true;
				return [];
			});
	} catch {
		dbError = true;
		keys = [];
	}

	const total = keys.length;
	const activeCount = keys.filter((k) => k.isActive).length;
	const inactiveCount = total - activeCount;

	return (
		<main>
			<section className="mt-6">
				{dbError ? (
					<div className="admin-card" style={{ marginTop: "1rem" }}>
						<p className="text-xs theme-text-muted dark:theme-text-muted m-0">
							{t("apiKeysForm.dbError")}
						</p>
					</div>
				) : (
					<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
						<StatusCard
							label={t("apiKeysForm.totalKeys")}
							value={total}
							icon="🔑"
						/>
						<StatusCard
							label={t("apiKeysForm.active")}
							value={activeCount}
							state={activeCount > 0 ? "ok" : "neutral"}
							icon="✅"
						/>
						<StatusCard
							label={t("apiKeysForm.inactive")}
							value={inactiveCount}
							state={inactiveCount > 0 ? "warn" : "neutral"}
							icon="🚫"
						/>
					</div>
				)}
			</section>

			<section className="mt-6">
				<h2>{t("apiKeysForm.generateKey")}</h2>
				<p className="text-xs theme-text-muted dark:theme-text-muted">
					{t("apiKeysForm.generateHint")}
				</p>
				<form action={createApiKey} className="admin-card">
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<label
								htmlFor="new_name"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("apiKeysForm.name")}
							</label>
							<input
								id="new_name"
								name="name"
								placeholder={t("apiKeysForm.namePlaceholder")}
								required
								maxLength={255}
								style={{ width: "100%" }}
							/>
						</div>
						<div>
							<label
								htmlFor="new_rateLimit"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("apiKeysForm.rateLimit")}
							</label>
							<input
								id="new_rateLimit"
								name="rateLimit"
								type="number"
								min={0}
								defaultValue={300}
								style={{ width: "100%" }}
							/>
						</div>
						<div style={{ gridColumn: "1 / -1" }}>
							<label
								htmlFor="new_allowedIps"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("apiKeysForm.allowedIps")}
							</label>
							<input
								id="new_allowedIps"
								name="allowedIps"
								placeholder={t("apiKeysForm.allowedIpsPlaceholder")}
								maxLength={255}
								style={{ width: "100%" }}
							/>
						</div>
					</div>
					<div style={{ marginTop: "0.75rem" }}>
						<Button type="submit" variant="default">
							{t("apiKeysForm.generate")}
						</Button>
					</div>
				</form>
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">
					{t("apiKeysForm.existingKeys", { count: total })}
				</h2>
				{total === 0 ? (
					<div className="admin-empty">{t("apiKeysForm.noKeys")}</div>
				) : (
					<div className="overflow-x-auto">
						<table>
							<thead>
								<tr>
									<th>#</th>
									<th>{t("apiKeysForm.colName")}</th>
									<th>{t("apiKeysForm.colKey")}</th>
									<th>{t("apiKeysForm.colAllowedIps")}</th>
									<th>{t("apiKeysForm.colRateLimit")}</th>
									<th>{t("apiKeysForm.colLastUsed")}</th>
									<th>{t("apiKeysForm.colExpires")}</th>
									<th>{t("apiKeysForm.colStatus")}</th>
									<th>{t("apiKeysForm.colActions")}</th>
								</tr>
							</thead>
							<tbody>
								{keys.map((k) => (
									<tr key={String(k.id)}>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{String(k.id)}
										</td>
										<td>{k.name}</td>
										<td>
											<code title={t("apiKeysForm.maskedHint")}>
												{maskKey(k.key)}
											</code>
										</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{k.allowedIps || t("apiKeysForm.any")}
										</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{k.rateLimit}/min
										</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{formatDate(k.lastUsedAt, "datetime", "\u2014")}
										</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{formatDate(k.expiresAt, "datetime", "\u2014")}
										</td>
										<td>
											<span
												className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${k.isActive ? "bg-[var(--admin-success-subtle)] text-[var(--admin-text)]" : "bg-[var(--admin-error-subtle)] text-[var(--admin-text)]"}`}
											>
												{k.isActive
													? t("apiKeysForm.activeLabel")
													: t("apiKeysForm.inactiveLabel")}
											</span>
										</td>
										<td>
											<div style={{ display: "inline-flex", gap: "0.4rem" }}>
												<form action={toggleApiKey}>
													<input type="hidden" name="id" value={String(k.id)} />
													<Button type="submit" variant="outline">
														{k.isActive
															? t("apiKeysForm.deactivate")
															: t("apiKeysForm.activate")}
													</Button>
												</form>
												<form action={deleteApiKey}>
													<input type="hidden" name="id" value={String(k.id)} />
													<Button type="submit" variant="destructive">
														{t("apiKeysForm.delete")}
													</Button>
												</form>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</main>
	);
}
