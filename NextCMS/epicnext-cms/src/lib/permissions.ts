import { eq, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { logAuthorizationEvent } from "./admin/authorization-events";
import { isDynamicSuperAdmin } from "./admin/authorization-policy";
import { resolveAuthorizationState } from "./admin/rank-authority";
import { auth } from "./auth";
import { sessionUserId } from "./auth/session-user";
import { db, queryRows, User } from "./db";
import { redirectSafe } from "./foundation/security";

// Re-export PERMS from the standalone file (safe for client components)
export { PERMS } from "./permission-slugs";

// ── Permission Set ──────────────────────────────────────────────────

export type { PermissionSet } from "@/types/admin";

import type { PermissionSet } from "@/types/admin";

function createEmptySet(): PermissionSet {
	return {
		has: () => false,
		hasAny: () => false,
		hasAll: () => false,
		isSuperAdmin: false,
	};
}

/**
 * Fetch all permission slugs for a user in a single SQL query.
 * Cached via unstable_cache with 60s TTL — invalidated via revalidateTag('permissions').
 */
const getCachedPermissionSlugs = unstable_cache(
	async (userId: number, rank: number): Promise<string[]> => {
		const rows = await queryRows<{ slug: string }>(sql`
      SELECT DISTINCT p.slug
      FROM acl_model_permissions mp
      JOIN acl_permissions p ON p.id = mp.permission_id
      WHERE mp.model_type = 'Role'
        AND mp.model_id IN (
          SELECT amr.role_id
          FROM acl_model_roles amr
          WHERE amr.model_type = 'User' AND amr.model_id = ${userId}
          UNION
          SELECT ar.id
          FROM acl_roles ar
          WHERE ar.slug = ${`rank_${rank}`}
        )
    `);
		return rows.map((r) => r.slug);
	},
	["user-permissions"],
	{ revalidate: 60, tags: ["permissions"] },
);

/**
 * Load permission slugs for a database-refreshed user rank. The dynamically
 * highest rank bypasses ACL checks.
 * Wrapped with React cache() to de-duplicate within the same request.
 */
export const loadUserPermissions = cache(async function loadUserPermissions(
	userId: number,
	rank: number,
	highestRank: number | null,
): Promise<PermissionSet> {
	try {
		// Super admin bypasses all permission checks — zero DB queries
		if (isDynamicSuperAdmin(rank, highestRank)) {
			return {
				has: () => true,
				hasAny: () => true,
				hasAll: () => true,
				isSuperAdmin: true,
			};
		}

		const slugArray = await getCachedPermissionSlugs(userId, rank);
		if (slugArray.length === 0) return createEmptySet();

		const slugs = new Set(slugArray);
		return {
			has: (perm: string) => slugs.has(perm),
			hasAny: (...perms: string[]) => perms.some((p) => slugs.has(p)),
			hasAll: (...perms: string[]) => perms.every((p) => slugs.has(p)),
			isSuperAdmin: false,
		};
	} catch (error) {
		await logAuthorizationEvent({
			kind: "permission.load_error",
			userId,
			rank,
			source: "loadUserPermissions",
			reason: "ACL query failed",
			error,
		});
		// Fail-closed: return empty set on any error
		return createEmptySet();
	}
});

/**
 * Highest rank the hotel currently has — i.e. who the dynamic owner is.
 * Rank comparisons ("can this staff member act on that user") must never be
 * hard-coded to a number, because hotels disagree on their top rank.
 * Memoised per request so several rank guards in one action cost one query.
 */
export const getHighestRank = cache(async (): Promise<number | null> => {
	const rows = await queryRows<{
		highest_rank: number | bigint | null;
	}>(sql`
        SELECT COALESCE(
          (
            SELECT MAX(u.\`rank\`)
            FROM users u
            INNER JOIN permission_ranks pr ON pr.id = u.\`rank\`
          ),
          (SELECT MAX(id) FROM permission_ranks)
        ) AS highest_rank
      `);
	return rows[0]?.highest_rank == null ? null : Number(rows[0].highest_rank);
});

const getCurrentAuthorizationState = cache(async (userId: number) =>
	resolveAuthorizationState(userId, {
		user: {
			findUnique: async ({ where }) => {
				const [row] = await db
					.select({
						id: User.id,
						username: User.username,
						rank: User.rank,
					})
					.from(User)
					.where(eq(User.id, where.id))
					.limit(1);
				return row ?? null;
			},
		},
		highestRank: async () => getHighestRank(),
	}),
);

// ── Context Helpers ─────────────────────────────────────────────────

/**
 * For server components: get session + load permissions.
 * Redirects to login if not authenticated.
 */
export async function getAdminContext() {
	const session = await auth();
	if (!session?.user) {
		redirectSafe("/login", "/login");
	}

	const userId = sessionUserId(session.user.id);
	if (!userId) redirectSafe("/login", "/login");
	const state = await getCurrentAuthorizationState(userId);
	if (!state) redirectSafe("/login", "/login");
	const permissions = await loadUserPermissions(
		userId,
		state.actor.rank,
		state.highestRank,
	);
	return {
		session: {
			...session,
			user: {
				...session.user,
				id: userId,
				username: state.actor.username,
				rank: state.actor.rank,
			},
		},
		permissions,
	};
}

/**
 * For API routes: get session + load permissions.
 * Returns null if not authenticated (caller handles 401).
 */
export async function getApiAdminContext() {
	const session = await auth();
	if (!session?.user) return null;

	const userId = sessionUserId(session.user.id);
	if (!userId) return null;
	const state = await getCurrentAuthorizationState(userId);
	if (!state) return null;
	const permissions = await loadUserPermissions(
		userId,
		state.actor.rank,
		state.highestRank,
	);
	return {
		session: {
			...session,
			user: {
				...session.user,
				id: userId,
				username: state.actor.username,
				rank: state.actor.rank,
			},
		},
		permissions,
	};
}

/**
 * Check if user has a specific permission.
 * All fallbacks are represented as ACL role permissions by migration 0011.
 */
export function canAccess(
	permissions: PermissionSet,
	slug: string,
	_rank?: number,
): boolean {
	return permissions.has(slug);
}
