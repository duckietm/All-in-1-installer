import {
	and,
	asc,
	count,
	desc,
	inArray,
	like,
	type SQL,
	sql,
} from "drizzle-orm";
import { ClipboardList } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { StatusCard } from "@/components/admin/dashboard";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import { db, StaffActivities, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { StaffActivitiesTable } from "./staff-activities-table";

const SORT_MAP = {
	when: StaffActivities.createdAt,
	staff: StaffActivities.userId,
	action: StaffActivities.action,
} as const;

export default async function AdminStaffActivities({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.LOGS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.logs");
	const raw = await searchParams;
	const parsed = parseListParams(new URLSearchParams(raw));
	const authorizationOnly = raw.filter_authorization === "1";

	const conditions: SQL[] = [];
	if (parsed.search.trim()) {
		const q = parsed.search.trim();
		conditions.push(
			sql`(${like(StaffActivities.action, `%${q}%`)} OR ${like(StaffActivities.description, `%${q}%`)} OR ${like(StaffActivities.ipAddress, `%${q}%`)})`,
		);
	}
	if (authorizationOnly) {
		conditions.push(like(StaffActivities.action, "permission.%"));
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const sortCol =
		SORT_MAP[(parsed.sort ?? "") as keyof typeof SORT_MAP] ??
		StaffActivities.createdAt;
	const orderBy = parsed.order === "asc" ? asc(sortCol) : desc(sortCol);

	const [totalRows] = await db
		.select({ total: count() })
		.from(StaffActivities)
		.where(where)
		.catch(() => [{ total: 0 }]);
	const total = Number(totalRows?.total ?? 0);

	const pagination = calcPagination(total, parsed.page, parsed.perPage);

	const activities = await db
		.select({
			id: StaffActivities.id,
			userId: StaffActivities.userId,
			action: StaffActivities.action,
			description: StaffActivities.description,
			targetType: StaffActivities.targetType,
			targetId: StaffActivities.targetId,
			ipAddress: StaffActivities.ipAddress,
			createdAt: StaffActivities.createdAt,
		})
		.from(StaffActivities)
		.where(where)
		.orderBy(orderBy)
		.limit(pagination.perPage)
		.offset(pagination.offset)
		.catch(() => []);

	const staffIds = Array.from(
		new Set(activities.map((a) => Number(a.userId))),
	).filter((n) => n > 0);
	let nameById = new Map<number, string>();
	if (staffIds.length) {
		const users = await db
			.select({ id: User.id, username: User.username })
			.from(User)
			.where(inArray(User.id, staffIds))
			.catch(() => []);
		nameById = new Map(users.map((x) => [x.id, x.username]));
	}

	const recentCount = activities.filter(
		(a) => a.createdAt && new Date(a.createdAt).getTime() > Date.now() - 60_000,
	).length;

	const rows = activities.map((a) => ({
		id: Number(a.id),
		when: formatDate(a.createdAt),
		staff: t("staffWithId", {
			id: Number(a.userId),
			name: nameById.get(Number(a.userId)) ?? t("unknownUser"),
		}),
		action: a.action,
		description: a.description,
		target:
			a.targetType && a.targetId
				? `${a.targetType === "user" ? t("userPrefix") : a.targetType} #${String(a.targetId)}`
				: "—",
		ip: a.ipAddress || "—",
	}));

	return (
		<AdminPageShell
			icon={ClipboardList}
			title={t("title")}
			subtitle={t("subtitle")}
		>
			<div className="space-y-6">
				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5">
					<StatusCard label={t("totalActivities")} value={total} icon="📋" />
					<StatusCard
						label={t("onThisPage")}
						value={activities.length}
						icon="📄"
					/>
					<StatusCard
						label={t("recent")}
						value={recentCount}
						state={recentCount > 0 ? "ok" : "neutral"}
						icon="🟢"
					/>
				</div>

				<StaffActivitiesTable
					data={{
						rows,
						total,
						page: pagination.page,
						perPage: pagination.perPage,
						lastPage: pagination.lastPage,
					}}
				/>
			</div>
		</AdminPageShell>
	);
}
