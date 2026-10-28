import { count, desc, eq, inArray, like, or } from "drizzle-orm";
import { Shield } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { AdminSimplePager } from "@/components/admin/admin-simple-pager";
import { StatusCard } from "@/components/admin/dashboard";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import { db, Guilds, GuildsMembers, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { getCachedAdminCount } from "@/lib/services/admin-stats";

export default async function AdminGuildsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.USERS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.guilds");
	const raw = await searchParams;
	const parsed = parseListParams(new URLSearchParams(raw));
	const q = parsed.search.trim();

	let total = 0;
	let rows: Array<{
		id: number;
		name: string;
		description: string;
		userId: number;
		badge: string;
		dateCreated: number;
		roomId: number;
	}> = [];
	let loadError = false;

	try {
		const where = q
			? or(
					like(Guilds.name, `%${q}%`),
					like(Guilds.description, `%${q}%`),
					...(Number.isFinite(Number(q)) && Number(q) > 0
						? [eq(Guilds.id, Number(q))]
						: []),
				)
			: undefined;

		total = await getCachedAdminCount(Guilds, "guilds", where);
		const pagination = calcPagination(total, parsed.page, parsed.perPage);
		rows = await db
			.select({
				id: Guilds.id,
				name: Guilds.name,
				description: Guilds.description,
				userId: Guilds.userId,
				badge: Guilds.badge,
				dateCreated: Guilds.dateCreated,
				roomId: Guilds.roomId,
			})
			.from(Guilds)
			.where(where)
			.orderBy(desc(Guilds.id))
			.limit(pagination.perPage)
			.offset(pagination.offset);
	} catch {
		loadError = true;
	}

	const pagination = calcPagination(total, parsed.page, parsed.perPage);
	const ownerIds = [
		...new Set(rows.map((r) => r.userId).filter((id) => id > 0)),
	];
	const guildIds = rows.map((r) => r.id);

	const [owners, memberGroups] = await Promise.all([
		ownerIds.length
			? db
					.select({ id: User.id, username: User.username })
					.from(User)
					.where(inArray(User.id, ownerIds))
					.catch(() => [])
			: Promise.resolve([]),
		guildIds.length
			? db
					.select({
						guildId: GuildsMembers.guildId,
						total: count(),
					})
					.from(GuildsMembers)
					.where(inArray(GuildsMembers.guildId, guildIds))
					.groupBy(GuildsMembers.guildId)
					.catch(() => [])
			: Promise.resolve([]),
	]);

	const ownerById = new Map(owners.map((u) => [u.id, u.username]));
	const membersByGuild = new Map(
		memberGroups.map((g) => [g.guildId, Number(g.total)]),
	);

	return (
		<AdminPageShell icon={Shield} title={t("title")} subtitle={t("subtitle")}>
			<main>
				{loadError ? (
					<div className="mb-4 rounded-lg bg-[var(--admin-error-subtle)] p-3 text-xs text-[var(--admin-error)]">
						{t("loadError")}
					</div>
				) : null}

				<form className="mb-4 flex gap-2" method="get">
					<input
						type="search"
						name="search"
						defaultValue={q}
						placeholder={t("searchPlaceholder")}
						className="admin-input flex-1"
					/>
					<Button type="submit" variant="default" size="sm">
						{t("search")}
					</Button>
				</form>

				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
					<StatusCard label={t("totalGuilds")} value={total} icon="🛡️" />
				</div>

				<section>
					<h2 className="admin-section-title">
						{t("listHeading", { count: total })}
					</h2>
					{rows.length === 0 ? (
						<div className="admin-empty">{t("empty")}</div>
					) : (
						<div className="admin-card overflow-x-auto" style={{ padding: 0 }}>
							<table>
								<thead>
									<tr>
										<th>{t("colId")}</th>
										<th>{t("colBadge")}</th>
										<th>{t("colName")}</th>
										<th>{t("colOwner")}</th>
										<th>{t("colMembers")}</th>
										<th>{t("colCreated")}</th>
									</tr>
								</thead>
								<tbody>
									{rows.map((g) => (
										<tr key={g.id}>
											<td className="muted">{g.id}</td>
											<td>
												{g.badge ? (
													<img
														src={`https://habbo-stories-content.s3.amazonaws.com/badge-part-images/${g.badge}.gif`}
														alt=""
														width={40}
														height={40}
														className="h-10 w-10 object-contain"
													/>
												) : (
													<span className="muted">—</span>
												)}
											</td>
											<td>
												<Link
													href={`/admin/guilds/${g.id}`}
													className="font-medium hover:underline"
												>
													{g.name || `#${g.id}`}
												</Link>
												{g.description ? (
													<div className="muted text-xs line-clamp-1 max-w-xs">
														{g.description}
													</div>
												) : null}
											</td>
											<td>
												<Link href={`/admin/users/show/${g.userId}`}>
													{ownerById.get(g.userId) ?? `#${g.userId}`}
												</Link>
											</td>
											<td>{membersByGuild.get(g.id) ?? 0}</td>
											<td className="muted">
												{formatDate(new Date(g.dateCreated * 1000), "date")}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					<AdminSimplePager
						page={pagination.page}
						lastPage={pagination.lastPage}
						total={total}
						basePath="/admin/guilds"
						params={q ? { search: q } : undefined}
					/>
				</section>
			</main>
		</AdminPageShell>
	);
}
