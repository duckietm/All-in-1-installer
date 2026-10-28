import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminSimplePager } from "@/components/admin/admin-simple-pager";
import { StatusCard } from "@/components/admin/dashboard";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import { queryRows } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

type SubRow = {
	id: number;
	userId: number | null;
	subscriptionType: string | null;
	expiresAt: number;
};

type CountRow = { c: number | bigint };
type SubSqlRow = {
	id: number;
	user_id: number | null;
	subscription_type: string | null;
	expires_at: number;
};

async function rawRows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
	return queryRows<T>(query);
}

export default async function AdminSubscriptions({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SHOP_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.subscriptions");
	const now = Math.floor(Date.now() / 1000);
	const raw = await searchParams;
	const parsed = parseListParams(new URLSearchParams(raw));

	let active: SubRow[] = [];
	let total = 0;
	let types = 0;
	let expiringSoon = 0;
	let loadError = false;
	try {
		const [countRows, typeRows, soonRows] = await Promise.all([
			rawRows<CountRow>(sql`
				SELECT COUNT(*) AS c
				FROM users_subscriptions
				WHERE active = 1
				  AND COALESCE(timestamp_start, 0) + COALESCE(duration, 0) > ${now}
			`),
			rawRows<CountRow>(sql`
				SELECT COUNT(DISTINCT subscription_type) AS c
				FROM users_subscriptions
				WHERE active = 1
				  AND COALESCE(timestamp_start, 0) + COALESCE(duration, 0) > ${now}
			`),
			rawRows<CountRow>(sql`
				SELECT COUNT(*) AS c
				FROM users_subscriptions
				WHERE active = 1
				  AND COALESCE(timestamp_start, 0) + COALESCE(duration, 0) > ${now}
				  AND COALESCE(timestamp_start, 0) + COALESCE(duration, 0) <= ${now + 7 * 24 * 60 * 60}
			`),
		]);
		total = Number(countRows[0]?.c ?? 0);
		types = Number(typeRows[0]?.c ?? 0);
		expiringSoon = Number(soonRows[0]?.c ?? 0);
		const pagination = calcPagination(total, parsed.page, parsed.perPage);

		const rows = await rawRows<SubSqlRow>(sql`
			SELECT id,
			       user_id,
			       subscription_type,
			       COALESCE(timestamp_start, 0) + COALESCE(duration, 0) AS expires_at
			FROM users_subscriptions
			WHERE active = 1
			  AND COALESCE(timestamp_start, 0) + COALESCE(duration, 0) > ${now}
			ORDER BY expires_at ASC
			LIMIT ${pagination.perPage} OFFSET ${pagination.offset}
		`);

		active = rows.map((r) => ({
			id: Number(r.id),
			userId: r.user_id == null ? null : Number(r.user_id),
			subscriptionType: r.subscription_type,
			expiresAt: Number(r.expires_at),
		}));
	} catch {
		active = [];
		total = 0;
		types = 0;
		expiringSoon = 0;
		loadError = true;
	}

	const pagination = calcPagination(total, parsed.page, parsed.perPage);
	const soonCutoff = now + 7 * 24 * 60 * 60;

	return (
		<main>
			{loadError ? (
				<div className="mb-4 rounded-lg bg-[var(--admin-error-subtle)] p-3 text-xs text-[var(--admin-error)]">
					Could not load subscriptions (database unavailable).
				</div>
			) : null}
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard label={t("activeSubs")} value={total} icon="⭐" />
				<StatusCard label={t("types")} value={types} icon="🏷️" />
				<StatusCard
					label={t("expiringSoon")}
					value={expiringSoon}
					state={expiringSoon > 0 ? "warn" : "ok"}
					icon="⏳"
				/>
			</div>

			<section className="mt-6">
				<h2 className="admin-section-title">
					{t("activeSubscriptions")} ({total})
				</h2>
				<div className="admin-card">
					<table>
						<thead>
							<tr>
								<th>{t("colSubId")}</th>
								<th>{t("colUserId")}</th>
								<th>{t("colType")}</th>
								<th>{t("colStatus")}</th>
								<th>{t("colExpires")}</th>
							</tr>
						</thead>
						<tbody>
							{active.length === 0 ? (
								<tr>
									<td colSpan={5} className="muted">
										—
									</td>
								</tr>
							) : (
								active.map((s) => (
									<tr key={s.id}>
										<td>{s.id}</td>
										<td>{s.userId ?? "—"}</td>
										<td>{s.subscriptionType ?? "—"}</td>
										<td>
											{s.expiresAt <= soonCutoff ? t("expiringSoon") : "OK"}
										</td>
										<td>{formatDate(new Date(s.expiresAt * 1000))}</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
				<AdminSimplePager
					page={pagination.page}
					lastPage={pagination.lastPage}
					total={total}
					basePath="/admin/subscriptions"
				/>
			</section>
		</main>
	);
}
