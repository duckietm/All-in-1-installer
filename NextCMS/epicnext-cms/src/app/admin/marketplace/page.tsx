import { count, desc, eq, inArray } from "drizzle-orm";
import { Store } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cancelMarketplaceListing } from "@/actions/admin-marketplace";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { AdminSimplePager } from "@/components/admin/admin-simple-pager";
import { StatusCard } from "@/components/admin/dashboard";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import { db, MarketplaceItems, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function AdminMarketplacePage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SHOP_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.marketplace");
	const canEdit = canAccess(permissions, PERMS.SHOP_EDIT, session.user.rank);
	const raw = await searchParams;
	const parsed = parseListParams(new URLSearchParams(raw));
	const filter = raw.filter === "sold" ? "sold" : "active";

	const where = eq(MarketplaceItems.state, filter === "sold" ? 2 : 1);

	let total = 0;
	let rows: (typeof MarketplaceItems.$inferSelect)[] = [];
	let activeCount = 0;
	let soldCount = 0;
	let loadError = false;

	try {
		const [totalRows, activeRows, soldRows] = await Promise.all([
			db.select({ total: count() }).from(MarketplaceItems).where(where),
			db
				.select({ total: count() })
				.from(MarketplaceItems)
				.where(eq(MarketplaceItems.state, 1)),
			db
				.select({ total: count() })
				.from(MarketplaceItems)
				.where(eq(MarketplaceItems.state, 2)),
		]);
		total = Number(totalRows[0]?.total ?? 0);
		activeCount = Number(activeRows[0]?.total ?? 0);
		soldCount = Number(soldRows[0]?.total ?? 0);
		const pagination = calcPagination(total, parsed.page, parsed.perPage);
		rows = await db
			.select()
			.from(MarketplaceItems)
			.where(where)
			.orderBy(desc(MarketplaceItems.timestamp))
			.limit(pagination.perPage)
			.offset(pagination.offset);
	} catch {
		loadError = true;
	}

	const pagination = calcPagination(total, parsed.page, parsed.perPage);
	const userIds = [
		...new Set(rows.map((r) => r.userId).filter((id) => id > 0)),
	];
	const users =
		userIds.length > 0
			? await db
					.select({ id: User.id, username: User.username })
					.from(User)
					.where(inArray(User.id, userIds))
					.catch(() => [])
			: [];
	const usernameById = new Map(users.map((u) => [u.id, u.username]));

	return (
		<AdminPageShell icon={Store} title={t("title")} subtitle={t("subtitle")}>
			<main>
				{loadError ? (
					<div className="mb-4 rounded-lg bg-[var(--admin-error-subtle)] p-3 text-xs text-[var(--admin-error)]">
						{t("loadError")}
					</div>
				) : null}

				<div className="mb-4 flex flex-wrap gap-2">
					<Button
						variant={filter === "active" ? "default" : "ghost"}
						size="sm"
						asChild
					>
						<Link href="/admin/marketplace?filter=active">
							{t("filterActive")}
						</Link>
					</Button>
					<Button
						variant={filter === "sold" ? "default" : "ghost"}
						size="sm"
						asChild
					>
						<Link href="/admin/marketplace?filter=sold">{t("filterSold")}</Link>
					</Button>
				</div>

				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
					<StatusCard
						label={t("activeListings")}
						value={activeCount}
						icon="🏪"
					/>
					<StatusCard label={t("soldListings")} value={soldCount} icon="✅" />
				</div>

				<section>
					<h2 className="admin-section-title">
						{filter === "sold" ? t("soldListings") : t("activeListings")} (
						{total})
					</h2>
					{rows.length === 0 ? (
						<div className="admin-empty">{t("empty")}</div>
					) : (
						<div className="admin-card overflow-x-auto" style={{ padding: 0 }}>
							<table>
								<thead>
									<tr>
										<th>{t("colId")}</th>
										<th>{t("colItem")}</th>
										<th>{t("colSeller")}</th>
										<th>{t("colPrice")}</th>
										<th>{t("colListed")}</th>
										{filter === "sold" ? <th>{t("colSold")}</th> : null}
										{canEdit && filter === "active" ? (
											<th>{t("colActions")}</th>
										) : null}
									</tr>
								</thead>
								<tbody>
									{rows.map((row) => (
										<tr key={row.id}>
											<td className="muted">{row.id}</td>
											<td>
												<code>{row.itemId}</code>
											</td>
											<td>
												<Link href={`/admin/users/show/${row.userId}`}>
													{usernameById.get(row.userId) ?? `#${row.userId}`}
												</Link>
											</td>
											<td>{row.price}</td>
											<td className="muted">
												{formatDate(new Date(row.timestamp * 1000))}
											</td>
											{filter === "sold" ? (
												<td className="muted">
													{formatDate(
														row.soldTimestamp
															? new Date(row.soldTimestamp * 1000)
															: null,
													)}
												</td>
											) : null}
											{canEdit && filter === "active" ? (
												<td>
													<form action={cancelMarketplaceListing}>
														<input type="hidden" name="id" value={row.id} />
														<Button type="submit" variant="ghost" size="sm">
															{t("cancel")}
														</Button>
													</form>
												</td>
											) : null}
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
						basePath="/admin/marketplace"
						params={filter === "sold" ? { filter: "sold" } : undefined}
					/>
				</section>
			</main>
		</AdminPageShell>
	);
}
