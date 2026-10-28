import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	like,
	or,
	type SQL,
} from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { StatusCard } from "@/components/admin/dashboard";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import { db, User, WebsitePaypalTransactions } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { type TransactionRow, TransactionsTable } from "./transactions-table";

const PAID_STATUS = ["completed", "paid", "success", "approved"] as const;
const FAILED_STATUS = [
	"failed",
	"denied",
	"refunded",
	"cancelled",
	"canceled",
] as const;
const PENDING_STATUS = ["pending", "created", "processing"] as const;

function statusKind(
	status: string | null | undefined,
): TransactionRow["statusKind"] {
	if (!status) return "neutral";
	const s = status.toLowerCase();
	if ((PAID_STATUS as readonly string[]).includes(s)) return "ok";
	if ((FAILED_STATUS as readonly string[]).includes(s)) return "danger";
	return "neutral";
}

function formatAmount(amount: number, currency: string): string {
	const n = Number(amount);
	const value = Number.isFinite(n) ? n.toFixed(2) : "0.00";
	return `${value} ${currency}`;
}

export default async function AdminTransactions({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SHOP_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.transactions");
	const raw = await searchParams;
	const parsed = parseListParams(new URLSearchParams(raw));
	const statusFilter = raw.filter_status ?? "";

	const conditions: SQL[] = [];

	if (statusFilter === "paid") {
		conditions.push(
			inArray(WebsitePaypalTransactions.status, [...PAID_STATUS]),
		);
	} else if (statusFilter === "failed") {
		conditions.push(
			inArray(WebsitePaypalTransactions.status, [...FAILED_STATUS]),
		);
	} else if (statusFilter === "pending") {
		conditions.push(
			inArray(WebsitePaypalTransactions.status, [...PENDING_STATUS]),
		);
	}

	if (parsed.search.trim()) {
		const q = parsed.search.trim();
		const asId = Number(q);
		let userIds: number[] = [];
		try {
			const users = await db
				.select({ id: User.id })
				.from(User)
				.where(like(User.username, `%${q}%`))
				.limit(50);
			userIds = users.map((u) => u.id);
		} catch {
			userIds = [];
		}

		const searchFilter = or(
			like(WebsitePaypalTransactions.transactionId, `%${q}%`),
			like(WebsitePaypalTransactions.description, `%${q}%`),
			...(Number.isFinite(asId) && asId > 0
				? [eq(WebsitePaypalTransactions.userId, asId)]
				: []),
			...(userIds.length
				? [inArray(WebsitePaypalTransactions.userId, userIds)]
				: []),
		);
		if (searchFilter) conditions.push(searchFilter);
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	let total = 0;
	try {
		const [totalRow] = await db
			.select({ total: count() })
			.from(WebsitePaypalTransactions)
			.where(where);
		total = Number(totalRow?.total ?? 0);
	} catch {
		total = 0;
	}

	const pagination = calcPagination(total, parsed.page, parsed.perPage);
	const orderCol =
		parsed.sort === "amount"
			? WebsitePaypalTransactions.amount
			: parsed.sort === "date"
				? WebsitePaypalTransactions.createdAt
				: parsed.sort === "status"
					? WebsitePaypalTransactions.status
					: parsed.sort === "package"
						? WebsitePaypalTransactions.description
						: parsed.sort === "payer"
							? WebsitePaypalTransactions.userId
							: WebsitePaypalTransactions.id;
	const orderBy = parsed.order === "asc" ? asc(orderCol) : desc(orderCol);

	let transactions: (typeof WebsitePaypalTransactions.$inferSelect)[] = [];
	try {
		transactions = await db
			.select()
			.from(WebsitePaypalTransactions)
			.where(where)
			.orderBy(orderBy)
			.limit(pagination.perPage)
			.offset(pagination.offset);
	} catch {
		transactions = [];
	}

	const userIds = [...new Set(transactions.map((x) => x.userId))];
	let names = new Map<number, string>();
	if (userIds.length > 0) {
		try {
			const users = await db
				.select({ id: User.id, username: User.username })
				.from(User)
				.where(inArray(User.id, userIds));
			names = new Map(users.map((u) => [u.id, u.username]));
		} catch {
			names = new Map();
		}
	}

	const rows: TransactionRow[] = transactions.map((x) => ({
		id: Number(x.id),
		payer: names.get(x.userId) ?? `#${x.userId}`,
		payerId: x.userId,
		amount: formatAmount(x.amount, x.currency),
		package: x.description ?? "—",
		status: x.status ?? "",
		statusKind: statusKind(x.status),
		transactionId: x.transactionId,
		date: formatDate(x.createdAt),
	}));

	const pagePaid = rows.filter((r) => r.statusKind === "ok").length;
	const pageFailed = rows.filter((r) => r.statusKind === "danger").length;

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard label={t("totalTransactions")} value={total} icon="🧾" />
				<StatusCard
					label={t("pagePaid")}
					value={pagePaid}
					state={pagePaid > 0 ? "ok" : "neutral"}
					icon="💳"
				/>
				<StatusCard
					label={t("pageFailed")}
					value={pageFailed}
					state={pageFailed > 0 ? "danger" : "neutral"}
					icon="⚠️"
				/>
			</div>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("title")}</h2>
				{total === 0 && !parsed.search && !statusFilter ? (
					<div className="admin-empty">{t("noTransactions")}</div>
				) : (
					<TransactionsTable
						data={{
							rows,
							total,
							page: pagination.page,
							perPage: pagination.perPage,
							lastPage: pagination.lastPage,
						}}
					/>
				)}
			</section>
		</main>
	);
}
