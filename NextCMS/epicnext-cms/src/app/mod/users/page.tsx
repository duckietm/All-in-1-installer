import { and, asc, count, desc, eq, like, or, type SQL } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { DataTable } from "@/components/admin/data-table";
import Link from "@/components/link";
import { AvatarImage } from "@/components/shared/avatar-image";
import { Badge } from "@/components/ui/badge";
import { requireModPermission } from "@/lib/admin/guard";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import { db, User } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { logServerError } from "@/lib/server-log";
import type { DataTableColumn } from "@/types/common";

type ModUserRow = {
	id: number;
	username: string;
	rank: number;
	online: string;
	motto: string;
	look: string;
	lastLogin: number | null;
};

const columns: DataTableColumn<ModUserRow>[] = [
	{ key: "id", label: "ID", sortable: true },
	{
		key: "username",
		label: "User",
		sortable: true,
		render: (_, row) => (
			<div className="flex items-center gap-2.5">
				<AvatarImage
					figure={row.look}
					options={{ size: "m", direction: 2, headDirection: 2 }}
					alt=""
					width={32}
					height={32}
					className="rounded"
				/>
				<span className="font-medium">{row.username}</span>
			</div>
		),
	},
	{
		key: "rank",
		label: "Rank",
		sortable: true,
		render: (v) => <Badge variant="secondary">#{String(v)}</Badge>,
	},
	{
		key: "online",
		label: "Online",
		render: (v) =>
			v === "1" ? (
				<Badge className="bg-[var(--admin-success)]">Online</Badge>
			) : (
				<Badge variant="outline">Offline</Badge>
			),
	},
	{
		key: "motto",
		label: "Motto",
		render: (v) => (
			<span className="text-muted-foreground truncate max-w-[220px] block">
				{String(v || "—")}
			</span>
		),
	},
	{
		key: "actions",
		label: "",
		render: (_, row) => (
			<div className="flex gap-2 justify-end">
				<Link
					href={`/mod/users/${row.id}`}
					className="text-sm text-[var(--admin-accent)] underline-offset-2 hover:underline"
				>
					Mod view
				</Link>
				<Link
					href={`/u/${row.username}`}
					className="text-sm text-muted-foreground underline-offset-2 hover:underline"
				>
					Public
				</Link>
			</div>
		),
	},
];

const SORT_COLS = {
	id: User.id,
	username: User.username,
	rank: User.rank,
	online: User.online,
	motto: User.motto,
	lastLogin: User.lastLogin,
} as const;

export default async function ModUsersPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	await requireModPermission([PERMS.MOD_USERS_VIEW, PERMS.USERS_VIEW]);
	const t = await getTranslations("pages.mod");
	const raw = await searchParams;
	const parsed = parseListParams(new URLSearchParams(raw));

	const conditions: SQL[] = [];
	if (parsed.search.trim()) {
		const q = parsed.search.trim();
		const ors = [like(User.username, `%${q}%`), like(User.motto, `%${q}%`)];
		if (Number.isFinite(Number(q)) && Number(q) > 0) {
			ors.push(eq(User.id, Number(q)));
		}
		const searchFilter = or(...ors);
		if (searchFilter) conditions.push(searchFilter);
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const sortKey =
		parsed.sort && parsed.sort in SORT_COLS
			? (parsed.sort as keyof typeof SORT_COLS)
			: "id";
	const sortCol = SORT_COLS[sortKey];
	const finalOrder =
		parsed.sort && parsed.sort in SORT_COLS
			? parsed.order === "asc"
				? asc(sortCol)
				: desc(sortCol)
			: desc(User.id);

	const [totals, users] = await Promise.all([
		db
			.select({ total: count() })
			.from(User)
			.where(where)
			.then((rows) => rows[0]?.total ?? 0)
			.catch((error) => {
				logServerError("users.count_failed", error);
				return 0;
			}),
		db
			.select({
				id: User.id,
				username: User.username,
				rank: User.rank,
				online: User.online,
				motto: User.motto,
				look: User.look,
				lastLogin: User.lastLogin,
			})
			.from(User)
			.where(where)
			.orderBy(finalOrder)
			.offset((parsed.page - 1) * parsed.perPage)
			.limit(parsed.perPage)
			.catch((error) => {
				logServerError("users.query_failed", error);
				return [] as ModUserRow[];
			}),
	]);

	const total = totals;
	const pagination = calcPagination(total, parsed.page, parsed.perPage);
	const rows: ModUserRow[] = users;

	return (
		<div className="space-y-6">
			<div>
				<h2 className="admin-section-title m-0">{t("usersTitle")}</h2>
				<p className="mt-1 text-sm text-[var(--admin-text-muted)]">
					{t("usersSubtitle")}
				</p>
			</div>
			{total === 0 && !parsed.search ? (
				<div className="admin-empty">{t("usersEmpty")}</div>
			) : (
				<DataTable
					columns={columns}
					data={{
						rows,
						total,
						page: pagination.page,
						perPage: pagination.perPage,
						lastPage: pagination.lastPage,
					}}
					searchPlaceholder={t("usersSearchPlaceholder")}
				/>
			)}
		</div>
	);
}
