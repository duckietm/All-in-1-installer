import { desc, eq, gt, or } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { StatusCard } from "@/components/admin/dashboard";
import { requireModPermission } from "@/lib/admin/guard";
import { unixNow } from "@/lib/bans";
import { Ban, db } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { PERMS } from "@/lib/permissions";

type BanRow = {
	id: number;
	userId: number;
	type: "account" | "ip" | "machine" | "super";
	banReason: string;
	banExpire: number;
};

export default async function ModBansPage() {
	await requireModPermission([PERMS.MOD_BANS_VIEW, PERMS.BANS_VIEW]);

	const t = await getTranslations("pages.admin.bans");
	const now = unixNow();
	let bans: BanRow[] = [];
	try {
		bans = await db
			.select({
				id: Ban.id,
				userId: Ban.userId,
				type: Ban.type,
				banReason: Ban.banReason,
				banExpire: Ban.banExpire,
			})
			.from(Ban)
			.where(or(eq(Ban.banExpire, 0), gt(Ban.banExpire, now)))
			.orderBy(desc(Ban.timestamp))
			.limit(100);
	} catch {
		bans = [];
	}

	const permanent = bans.filter((b) => b.banExpire === 0).length;
	const accountBans = bans.filter((b) => b.type === "account").length;

	return (
		<main>
			<p className="mb-4 text-sm text-[var(--admin-text-muted)]">
				Read-only ban list for moderators. Create/lift bans requires the full
				admin panel.
			</p>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard
					label={t("activeBans")}
					value={bans.length}
					state={bans.length > 0 ? "warn" : "ok"}
					icon="🔨"
				/>
				<StatusCard
					label={t("permanent")}
					value={permanent}
					state={permanent > 0 ? "danger" : "neutral"}
					icon="⛔"
				/>
				<StatusCard label={t("accountBans")} value={accountBans} icon="👤" />
			</div>

			<section className="mt-6">
				<h2 className="admin-section-title">
					{t("activeBans")} ({bans.length})
				</h2>
				{bans.length === 0 ? (
					<div className="admin-empty">{t("noBans")}</div>
				) : (
					<div className="overflow-x-auto">
						<table>
							<thead>
								<tr>
									<th scope="col">{t("colUserId")}</th>
									<th scope="col">{t("colType")}</th>
									<th scope="col">{t("colReason")}</th>
									<th scope="col">{t("colExpires")}</th>
								</tr>
							</thead>
							<tbody>
								{bans.map((b) => (
									<tr key={b.id}>
										<td>{b.userId}</td>
										<td>
											<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-accent)]/18 text-[var(--admin-text)]">
												{b.type}
											</span>
										</td>
										<td>{b.banReason || "—"}</td>
										<td>
											{b.banExpire === 0 ? (
												<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-error-subtle)] text-[var(--admin-text)]">
													{t("permanent")}
												</span>
											) : (
												formatDate(new Date(b.banExpire * 1000))
											)}
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
