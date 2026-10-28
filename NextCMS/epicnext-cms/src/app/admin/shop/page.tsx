import { asc, count, desc } from "drizzle-orm";
import { ShoppingCart } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { AdminSimplePager } from "@/components/admin/admin-simple-pager";
import { StatusCard } from "@/components/admin/dashboard";
import Link from "@/components/link";
import { CurrencyIcon } from "@/components/shared/currency-icon";
import { Button } from "@/components/ui/button";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import { db, WebsitePaypalTransactions, WebsiteShopArticles } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

const PAID_STATUS = new Set(["completed", "paid", "success", "approved"]);
const RECENT_ORDERS = 25;

function statusState(
	status: string | null | undefined,
): "ok" | "danger" | undefined {
	if (!status) return undefined;
	const s = status.toLowerCase();
	if (PAID_STATUS.has(s)) return "ok";
	if (
		s === "failed" ||
		s === "denied" ||
		s === "refunded" ||
		s === "cancelled" ||
		s === "canceled"
	)
		return "danger";
	return undefined;
}

function CurrencyCell({
	kind,
	value,
}: {
	kind: "credits" | "duckets" | "diamonds";
	value: number | null | undefined;
}) {
	if (value == null) {
		return <span className="muted">—</span>;
	}
	return (
		<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
			<CurrencyIcon kind={kind} size={14} />
			{value}
		</span>
	);
}

export default async function AdminShop({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SHOP_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.shop");
	const raw = await searchParams;
	const parsed = parseListParams(new URLSearchParams(raw));

	let packageTotal = 0;
	let packages: (typeof WebsiteShopArticles.$inferSelect)[] = [];
	let loadError = false;
	try {
		const [totalRow] = await db
			.select({ total: count() })
			.from(WebsiteShopArticles);
		packageTotal = Number(totalRow?.total ?? 0);
		const pagination = calcPagination(
			packageTotal,
			parsed.page,
			parsed.perPage,
		);
		packages = await db
			.select()
			.from(WebsiteShopArticles)
			.orderBy(asc(WebsiteShopArticles.position), asc(WebsiteShopArticles.name))
			.limit(pagination.perPage)
			.offset(pagination.offset);
	} catch {
		packages = [];
		packageTotal = 0;
		loadError = true;
	}

	const pkgPagination = calcPagination(
		packageTotal,
		parsed.page,
		parsed.perPage,
	);

	let orders: (typeof WebsitePaypalTransactions.$inferSelect)[] = [];
	try {
		orders = await db
			.select()
			.from(WebsitePaypalTransactions)
			.orderBy(desc(WebsitePaypalTransactions.createdAt))
			.limit(RECENT_ORDERS);
	} catch {
		orders = [];
		loadError = true;
	}

	const paidOrders = orders.filter(
		(o) => statusState(o.status) === "ok",
	).length;

	return (
		<AdminPageShell
			icon={ShoppingCart}
			title={t("title")}
			subtitle={t("subtitle")}
			actions={
				<Button variant="default" asChild>
					<Link href="/admin/shop/new">{t("newPackage")}</Link>
				</Button>
			}
		>
			<main>
				{loadError ? (
					<div className="mb-4 rounded-lg bg-[var(--admin-error-subtle)] p-3 text-xs text-[var(--admin-error)]">
						Could not load some shop data (database unavailable).
					</div>
				) : null}

				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
					<StatusCard label={t("packages")} value={packageTotal} icon="🛍️" />
					<StatusCard
						label={t("recentOrders")}
						value={orders.length}
						icon="🧾"
					/>
					<StatusCard
						label={t("paidOrders")}
						value={paidOrders}
						state={paidOrders > 0 ? "ok" : "neutral"}
						icon="💳"
					/>
				</div>

				<section className="mt-6">
					<h2 className="admin-section-title">
						{t("packagesTotal", { count: packageTotal })}
					</h2>
					{packages.length === 0 ? (
						<div className="admin-empty">{t("noPackages")}</div>
					) : (
						<div className="admin-card overflow-x-auto" style={{ padding: 0 }}>
							<table>
								<thead>
									<tr>
										<th>#</th>
										<th>{t("colName")}</th>
										<th>{t("colPrice")}</th>
										<th>{t("colCredits")}</th>
										<th>{t("colDuckets")}</th>
										<th>{t("colDiamonds")}</th>
										<th>{t("colRank")}</th>
										<th>{t("colPosition")}</th>
									</tr>
								</thead>
								<tbody>
									{packages.map((p) => (
										<tr key={String(p.id)}>
											<td className="muted">{String(p.id)}</td>
											<td>
												<Link href={`/admin/shop/${p.id}`}>{p.name}</Link>
											</td>
											<td>{p.costs}</td>
											<td>
												<CurrencyCell kind="credits" value={p.credits} />
											</td>
											<td>
												<CurrencyCell kind="duckets" value={p.duckets} />
											</td>
											<td>
												<CurrencyCell kind="diamonds" value={p.diamonds} />
											</td>
											<td className="muted">{p.giveRank ?? "—"}</td>
											<td className="muted">{p.position}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					<AdminSimplePager
						page={pkgPagination.page}
						lastPage={pkgPagination.lastPage}
						total={packageTotal}
						basePath="/admin/shop"
					/>
				</section>

				<section className="mt-6">
					<h2 className="admin-section-title">
						{t("recentOrders")} ({orders.length})
					</h2>
					<p className="muted -mt-1 mb-3 text-sm">{t("ordersHint")}</p>
					{orders.length === 0 ? (
						<div className="admin-empty">{t("noOrders")}</div>
					) : (
						<div className="admin-card overflow-x-auto" style={{ padding: 0 }}>
							<table>
								<thead>
									<tr>
										<th>{t("colTransaction")}</th>
										<th>{t("colUser")}</th>
										<th>{t("colDescription")}</th>
										<th>{t("colAmount")}</th>
										<th>{t("colStatus")}</th>
										<th>{t("colDate")}</th>
									</tr>
								</thead>
								<tbody>
									{orders.map((o) => {
										const state = statusState(o.status);
										return (
											<tr key={String(o.id)}>
												<td>
													<code>{o.transactionId}</code>
												</td>
												<td className="muted">
													<Link href={`/admin/users/${o.userId}`}>
														#{o.userId}
													</Link>
												</td>
												<td className="muted">{o.description ?? "—"}</td>
												<td>
													{o.amount} {o.currency}
												</td>
												<td>
													{o.status ? (
														<span
															className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${state === "ok" ? "bg-[var(--admin-success-subtle)] text-[var(--admin-text)]" : state === "danger" ? "bg-[var(--admin-error-subtle)] text-[var(--admin-text)]" : "bg-[var(--admin-accent)]/18 text-[var(--admin-text)]"}`}
														>
															{o.status}
														</span>
													) : (
														<span className="muted">—</span>
													)}
												</td>
												<td className="muted">
													{formatDate(o.createdAt, "date")}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</main>
		</AdminPageShell>
	);
}
