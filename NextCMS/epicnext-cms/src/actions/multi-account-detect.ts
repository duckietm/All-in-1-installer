"use server";

import { asc, count, desc, eq, gte, ne, sql } from "drizzle-orm";
import { requirePermission } from "@/lib/admin/guard";
import { db, User } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

export interface MultiAccountCluster {
	key: string;
	label: string;
	accountCount: number;
	accounts: Array<{
		id: number;
		username: string;
		rank: number;
		online: string;
	}>;
}

export async function detectMultiAccounts({
	minAccounts,
	limit,
}: {
	minAccounts: number;
	limit: number;
}) {
	await requirePermission(PERMS.USERS_VIEW);
	const clusters: MultiAccountCluster[] = [];

	const accountCount = count(User.id);
	const ipGroups = await db
		.select({
			ipCurrent: User.ipCurrent,
			accountCount,
		})
		.from(User)
		.where(ne(User.ipCurrent, ""))
		.groupBy(User.ipCurrent)
		.having(gte(accountCount, minAccounts))
		.orderBy(desc(sql`COUNT(${User.id})`))
		.limit(limit);

	for (const group of ipGroups) {
		const users = await db
			.select({
				id: User.id,
				username: User.username,
				rank: User.rank,
				online: User.online,
			})
			.from(User)
			.where(eq(User.ipCurrent, group.ipCurrent))
			.orderBy(asc(User.id));
		clusters.push({
			key: group.ipCurrent,
			label: `IP: ${group.ipCurrent}`,
			accountCount: Number(group.accountCount),
			accounts: users.map((u) => ({
				id: u.id,
				username: u.username,
				rank: u.rank,
				online: u.online,
			})),
		});
	}

	return { ok: true as const, data: { clusters } };
}
