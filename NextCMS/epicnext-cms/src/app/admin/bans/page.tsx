import { desc, eq, gt, or } from "drizzle-orm";
import { Ban as BanIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createBan, liftBan } from "@/actions/admin-bans";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { unixNow } from "@/lib/bans";
import { Ban, db } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function AdminBans({
	searchParams,
}: {
	searchParams: Promise<{ error?: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.BANS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const params = await searchParams;
	const t = await getTranslations("pages.admin.bans");
	const now = unixNow();
	let bans: (typeof Ban.$inferSelect)[] = [];
	try {
		bans = await db
			.select()
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
		<AdminPageShell icon={BanIcon} title={t("title")} subtitle={t("subtitle")}>
			<main>
				{params.error === "rank" ? (
					<p role="alert" className="text-sm text-[var(--admin-error)] mb-4">
						{t("rankError")}
					</p>
				) : null}
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

				<form action={createBan} className="admin-card mb-6">
					<h3 className="text-sm font-bold text-[var(--admin-text)] m-0 mb-3">
						{t("newBan")}
					</h3>
					<div className="flex gap-2 flex-wrap">
						<input
							name="userId"
							type="number"
							min={1}
							placeholder={t("userIdPlaceholder")}
							required
						/>
						<select name="type">
							<option value="account">{t("typeAccount")}</option>
							<option value="ip">{t("typeIp")}</option>
							<option value="machine">{t("typeMachine")}</option>
							<option value="super">{t("typeSuper")}</option>
						</select>
						<input
							name="hours"
							type="number"
							min={0}
							placeholder={t("hoursPlaceholder")}
						/>
						<input
							name="reason"
							placeholder={t("reasonPlaceholder")}
							className="flex-1 min-w-[160px]"
						/>
						<Button type="submit" variant="destructive">
							{t("ban")}
						</Button>
					</div>
				</form>

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
										<th>{t("colUserId")}</th>
										<th>{t("colType")}</th>
										<th>{t("colReason")}</th>
										<th>{t("colExpires")}</th>
										<th />
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
													<span className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
														{formatDate(new Date(b.banExpire * 1000))}
													</span>
												)}
											</td>
											<td>
												<form action={liftBan}>
													<input type="hidden" name="id" value={b.id} />
													<Button type="submit" variant="outline">
														{t("lift")}
													</Button>
												</form>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</main>
		</AdminPageShell>
	);
}
