import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { db, queryRows } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { fetchEmulatorRankSummaries } from "@/lib/services/permission-ranks";
import { PermissionsList } from "./permissions-list";

export default async function PermissionsPage({
	searchParams,
}: {
	params: Promise<{ locale: string }>;
	searchParams?: Promise<{ from?: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PERMISSIONS_MANAGE, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.permissionPreview");
	const sp = (await searchParams) ?? {};
	const fromHousekeeping = sp.from === "housekeeping";

	const ranks = await fetchEmulatorRankSummaries(db);

	// User counts per rank
	const rawCounts = await queryRows<{ rank: number; cnt: number }>(
		sql`SELECT \`rank\`, COUNT(*) as cnt FROM users GROUP BY \`rank\``,
	);
	const countMap: Record<number, number> = {};
	for (const row of rawCounts) {
		countMap[Number(row.rank)] = Number(row.cnt);
	}

	const ranksWithCounts = ranks.map((rank) => ({
		...rank,
		userCount: countMap[rank.id] ?? 0,
	}));

	return (
		<div className="space-y-4">
			<Link href="/admin/permissions/preview" className="btn btn-outline">
				{t("title")}
			</Link>
			<PermissionsList
				ranks={ranksWithCounts}
				fromHousekeeping={fromHousekeeping}
			/>
		</div>
	);
}
