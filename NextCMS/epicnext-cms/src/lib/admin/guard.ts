import { redirectSafe } from "@/lib/foundation/security";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export interface StaffUser {
	id: number;
	rank: number;
	username: string;
}

export async function requireStaff(): Promise<StaffUser> {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ADMIN_DASHBOARD, session.user.rank))
		redirectSafe("/", "/");
	return {
		id: session.user.id,
		rank: session.user.rank,
		username: session.user.username,
	};
}

/**
 * Staff gate plus a specific ACL slug. Use for FormData server actions that
 * must not stop at admin.dashboard alone (RCON, user edits, settings writes).
 */
export async function requirePermission(
	permission: string,
): Promise<StaffUser> {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ADMIN_DASHBOARD, session.user.rank))
		redirectSafe("/", "/");
	if (!canAccess(permissions, permission, session.user.rank))
		redirectSafe("/admin", "/admin");
	return {
		id: session.user.id,
		rank: session.user.rank,
		username: session.user.username,
	};
}

export async function requirePermissionRateLimited(
	permission: string,
): Promise<StaffUser> {
	const staff = await requirePermission(permission);
	const ip = await clientIp();
	if (!(await rateLimit(`admin:${staff.id}:${ip}`, 30, 60_000)).ok)
		redirectSafe("/admin?error=ratelimit", "/admin");
	return staff;
}

export async function requireStaffRateLimited(): Promise<StaffUser> {
	const staff = await requireStaff();
	const ip = await clientIp();
	if (!(await rateLimit(`admin:${staff.id}:${ip}`, 30, 60_000)).ok)
		redirectSafe("/admin?error=ratelimit", "/admin");
	return staff;
}

/**
 * Mod-lite gate: needs any mod.* / moderation ACL, not admin.dashboard.
 * Use for `/mod` layout so mid-ranks can access without full housekeeping.
 */
export async function requireMod(): Promise<StaffUser> {
	const { session, permissions } = await getAdminContext();
	const ok =
		canAccess(permissions, PERMS.MOD_DASHBOARD, session.user.rank) ||
		canAccess(permissions, PERMS.MODERATION_VIEW, session.user.rank) ||
		canAccess(permissions, PERMS.MOD_CFH_VIEW, session.user.rank) ||
		canAccess(permissions, PERMS.MOD_ACTIONS, session.user.rank) ||
		canAccess(permissions, PERMS.MOD_BANS_VIEW, session.user.rank) ||
		canAccess(permissions, PERMS.MOD_TICKETS_VIEW, session.user.rank) ||
		canAccess(permissions, PERMS.MOD_TEAM_VIEW, session.user.rank) ||
		canAccess(permissions, PERMS.MOD_USERS_VIEW, session.user.rank) ||
		canAccess(permissions, PERMS.TICKETS_VIEW, session.user.rank);
	if (!ok) redirectSafe("/", "/");
	return {
		id: session.user.id,
		rank: session.user.rank,
		username: session.user.username,
	};
}

/** Mod-lite page gate: any-of permission list (no admin.dashboard required). */
export async function requireModPermission(
	permission: string | readonly string[],
): Promise<StaffUser> {
	const staff = await requireMod();
	const { permissions } = await getAdminContext();
	const needed = Array.isArray(permission) ? permission : [permission];
	const ok = needed.some((slug) => canAccess(permissions, slug, staff.rank));
	if (!ok) redirectSafe("/mod", "/mod");
	return staff;
}
