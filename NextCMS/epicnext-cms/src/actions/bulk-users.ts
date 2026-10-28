"use server";

import { and, eq, inArray, max, sql } from "drizzle-orm";
import { isDynamicSuperAdmin } from "@/lib/admin/authorization-policy";
import { requirePermission } from "@/lib/admin/guard";
import {
	Ban,
	db,
	Sanctions,
	User,
	UsersBadges,
	UsersCurrency,
	UsersSettings,
} from "@/lib/db";
import { getHighestRank, PERMS } from "@/lib/permissions";
import type { ActionResult } from "@/lib/safe-action-shared";
import { rcon } from "@/lib/services/rcon";
import { logStaffActivity } from "@/lib/services/staff-activity";

/**
 * Bulk actions are plain server actions whose arguments come from the client,
 * so every one of them validates the payload and the target ranks first. The
 * helpers below are the whole "is this allowed" contract.
 */
const MAX_BULK_USERS = 200;

function parseUserIds(raw: unknown): number[] {
	if (!Array.isArray(raw)) return [];
	const ids = raw
		.map((v) => (typeof v === "number" ? v : Number(v)))
		.filter((v) => Number.isInteger(v) && v > 0);
	return [...new Set(ids)].slice(0, MAX_BULK_USERS);
}

function toPositiveInt(raw: unknown): number | null {
	const n = typeof raw === "number" ? raw : Number(raw);
	return Number.isInteger(n) && n > 0 ? n : null;
}

function parseAmount(raw: unknown, max = 1_000_000): number | null {
	const n = typeof raw === "number" ? raw : Number(raw);
	return Number.isInteger(n) && n > 0 && n <= max ? n : null;
}

function parseDuration(raw: unknown): number {
	const n = typeof raw === "number" ? raw : Number(raw);
	return Number.isInteger(n) && n > 0 ? Math.min(n, 60 * 60 * 24 * 365) : 0;
}

async function guardBulkTargets(
	staff: { id: number; rank: number },
	userIds: number[],
): Promise<void> {
	const highestRank = await getHighestRank();
	const superAdmin = isDynamicSuperAdmin(staff.rank, highestRank);
	if (superAdmin || userIds.length === 0) return;
	const rows = await db
		.select({ rank: User.rank })
		.from(User)
		.where(inArray(User.id, userIds));
	const blocked = rows.filter((r) => r.rank >= staff.rank);
	if (blocked.length > 0) {
		throw new Error(
			"Cannot act on a user at or above your rank — those ids were skipped",
		);
	}
}

export async function bulkUnban({
	userIds,
}: {
	userIds: number[];
}): Promise<ActionResult<{ unbanned: number; total: number }>> {
	const staff = await requirePermission(PERMS.USERS_EDIT);
	const ids = parseUserIds(userIds);
	await guardBulkTargets(staff, ids);
	const result = await db.delete(Ban).where(inArray(Ban.userId, ids));
	const unbanned = Number(result[0]?.affectedRows ?? 0);
	await logStaffActivity({
		staffId: staff.id,
		action: "bulk_unban",
		description: `Unbanned ${unbanned} user(s)`,
		targetType: "user",
	});
	return { ok: true as const, data: { unbanned, total: ids.length } };
}

export async function bulkBan({
	userIds,
	reason,
	duration,
}: {
	userIds: number[];
	reason: string;
	duration: number;
}): Promise<ActionResult<{ banned: number }>> {
	const staff = await requirePermission(PERMS.USERS_EDIT);
	const ids = parseUserIds(userIds);
	const seconds = parseDuration(duration);
	const reasonText = typeof reason === "string" ? reason.slice(0, 255) : "";
	await guardBulkTargets(staff, ids);
	const now = Math.floor(Date.now() / 1000);
	let banned = 0;

	for (const userId of ids) {
		try {
			await db.insert(Ban).values({
				userId,
				ip: "",
				machineId: "",
				userStaffId: staff.id,
				timestamp: now,
				banExpire: seconds > 0 ? now + seconds : 0,
				banReason: reasonText,
				type: "account",
			});
			banned++;
		} catch {
			// skip duplicates
		}
	}

	await logStaffActivity({
		staffId: staff.id,
		action: "bulk_ban",
		description: `Banned ${banned} user(s)`,
		targetType: "user",
	});
	return { ok: true as const, data: { banned } };
}

export async function bulkGiveCurrency({
	userIds,
	amount,
	type,
}: {
	userIds: number[];
	amount: number;
	type: "credits" | "pixels" | "points";
}): Promise<
	ActionResult<{
		given: number;
		total: number;
		failedIds: Array<{ userId: number; reason: string }>;
	}>
> {
	const staff = await requirePermission(PERMS.USERS_EDIT);
	const ids = parseUserIds(userIds);
	const value = parseAmount(amount);
	if (!value) throw new Error("Invalid amount");
	await guardBulkTargets(staff, ids);
	let given = 0;
	const failedIds: Array<{ userId: number; reason: string }> = [];

	for (const userId of ids) {
		try {
			if (type === "credits") {
				await db
					.update(User)
					.set({ credits: sql`${User.credits} + ${value}` })
					.where(eq(User.id, userId));
				await rcon.giveCredits(userId, value);
			} else if (type === "pixels") {
				await db
					.insert(UsersCurrency)
					.values({ userId, type: 0, amount: value })
					.onDuplicateKeyUpdate({
						set: { amount: sql`${UsersCurrency.amount} + ${value}` },
					});
				await rcon.giveDuckets(userId, value);
			} else if (type === "points") {
				await db
					.insert(UsersCurrency)
					.values({ userId, type: 101, amount: value })
					.onDuplicateKeyUpdate({
						set: { amount: sql`${UsersCurrency.amount} + ${value}` },
					});
				await rcon.givePointsGotw(userId, value);
			}
			given++;
		} catch {
			failedIds.push({ userId, reason: "Database error" });
		}
	}

	await logStaffActivity({
		staffId: staff.id,
		action: "bulk_give_currency",
		description: `Gave ${value} ${type} to ${given} user(s)`,
		targetType: "user",
	});
	return {
		ok: true as const,
		data: { given, total: userIds.length, failedIds },
	};
}

export async function bulkGiveBadge({
	userIds,
	badgeCode,
}: {
	userIds: number[];
	badgeCode: string;
}): Promise<
	ActionResult<{
		given: number;
		total: number;
		failedIds: Array<{ userId: number; reason: string }>;
	}>
> {
	const staff = await requirePermission(PERMS.USERS_EDIT);
	const ids = parseUserIds(userIds);
	const code =
		typeof badgeCode === "string" ? badgeCode.trim().slice(0, 64) : "";
	if (!code) throw new Error("Invalid badge code");
	await guardBulkTargets(staff, ids);
	let given = 0;
	const failedIds: Array<{ userId: number; reason: string }> = [];

	for (const userId of ids) {
		try {
			const [existing] = await db
				.select({ id: UsersBadges.id })
				.from(UsersBadges)
				.where(
					and(eq(UsersBadges.userId, userId), eq(UsersBadges.badgeCode, code)),
				)
				.limit(1);
			if (!existing) {
				const [agg] = await db
					.select({ maxSlot: max(UsersBadges.slotId) })
					.from(UsersBadges)
					.where(eq(UsersBadges.userId, userId));
				const slotId = (agg?.maxSlot ?? 0) + 1;
				await db
					.insert(UsersBadges)
					.values({ userId, slotId, badgeCode: code });
				await rcon.giveBadge(userId, code);
			}
			given++;
		} catch {
			failedIds.push({ userId, reason: "Database error" });
		}
	}

	await logStaffActivity({
		staffId: staff.id,
		action: "bulk_give_badge",
		description: `Gave badge "${badgeCode}" to ${given} user(s)`,
		targetType: "user",
	});
	return {
		ok: true as const,
		data: { given, total: userIds.length, failedIds },
	};
}

export async function bulkAdjustCurrency({
	userIds,
	amount,
	type,
}: {
	userIds: number[];
	/** Positive = give, negative = take. Balances clamped at 0. */
	amount: number;
	type: "credits" | "pixels" | "points";
}): Promise<
	ActionResult<{
		adjusted: number;
		total: number;
		failedIds: Array<{ userId: number; reason: string }>;
	}>
> {
	const staff = await requirePermission(PERMS.USERS_EDIT);
	const ids = parseUserIds(userIds);
	if (!Number.isFinite(amount) || amount === 0) {
		return { ok: false as const, error: "Amount must be a non-zero number" };
	}
	if (Math.abs(Math.trunc(amount)) > 1_000_000) {
		return { ok: false as const, error: "Amount is too large" };
	}
	await guardBulkTargets(staff, ids);

	if (amount > 0) {
		const given = await bulkGiveCurrency({ userIds: ids, amount, type });
		if (!given.ok) return given;
		if (!given.data) {
			return { ok: false as const, error: "Currency adjustment failed" };
		}
		return {
			ok: true as const,
			data: {
				adjusted: given.data.given,
				total: given.data.total,
				failedIds: given.data.failedIds,
			},
		};
	}

	const take = Math.abs(Math.trunc(amount));
	let adjusted = 0;
	const failedIds: Array<{ userId: number; reason: string }> = [];

	for (const userId of ids) {
		try {
			if (type === "credits") {
				const [user] = await db
					.select({ credits: User.credits })
					.from(User)
					.where(eq(User.id, userId))
					.limit(1);
				if (!user) {
					failedIds.push({ userId, reason: "Not found" });
					continue;
				}
				const next = Math.max(0, user.credits - take);
				await db.update(User).set({ credits: next }).where(eq(User.id, userId));
			} else {
				const currencyType = type === "pixels" ? 0 : 101;
				const [row] = await db
					.select({ amount: UsersCurrency.amount })
					.from(UsersCurrency)
					.where(
						and(
							eq(UsersCurrency.userId, userId),
							eq(UsersCurrency.type, currencyType),
						),
					)
					.limit(1);
				const current = row?.amount ?? 0;
				const next = Math.max(0, current - take);
				await db
					.insert(UsersCurrency)
					.values({ userId, type: currencyType, amount: next })
					.onDuplicateKeyUpdate({ set: { amount: next } });
			}
			adjusted++;
		} catch {
			failedIds.push({ userId, reason: "Database error" });
		}
	}

	await logStaffActivity({
		staffId: staff.id,
		action: "bulk_adjust_currency",
		description: `Adjusted ${amount} ${type} for ${adjusted} user(s) (DB-only take; no RCON debit)`,
		targetType: "user",
	});
	return {
		ok: true as const,
		data: { adjusted, total: userIds.length, failedIds },
	};
}

/**
 * Persist trade lock on `sanctions.trade_locked_until` + `users_settings.can_trade`
 * via Drizzle, then best-effort RCON sync (settradelock + alert + disconnect if online).
 */
export async function setTradeLock({
	userId,
	untilUnix,
}: {
	userId: number;
	/** Unix seconds; 0 clears the lock. */
	untilUnix: number;
}): Promise<ActionResult<{ userId: number; untilUnix: number }>> {
	const staff = await requirePermission(PERMS.USERS_EDIT);
	const id = toPositiveInt(userId);
	if (!id) return { ok: false as const, error: "Invalid user" };
	const until = Math.max(0, Math.min(Math.trunc(untilUnix), 2_000_000_000));
	const locked = until > 0;
	await guardBulkTargets(staff, [id]);

	const [user] = await db
		.select({
			id: User.id,
			username: User.username,
			online: User.online,
		})
		.from(User)
		.where(eq(User.id, id))
		.limit(1);
	if (!user) {
		return { ok: false as const, error: "User not found" };
	}

	await db.transaction(async (tx) => {
		const [existing] = await tx
			.select({ id: Sanctions.id })
			.from(Sanctions)
			.where(eq(Sanctions.habboId, userId))
			.limit(1);
		if (existing) {
			await tx
				.update(Sanctions)
				.set({
					tradeLockedUntil: until,
					...(locked ? { reason: "Trade lock (CMS)" } : {}),
				})
				.where(eq(Sanctions.id, existing.id));
		} else {
			await tx.insert(Sanctions).values({
				habboId: id,
				tradeLockedUntil: until,
				reason: locked ? "Trade lock (CMS)" : "",
			});
		}

		await tx
			.update(UsersSettings)
			.set({
				canTrade: locked ? "0" : "1",
				...(locked
					? { tradelockAmount: sql`${UsersSettings.tradelockAmount} + 1` }
					: {}),
			})
			.where(eq(UsersSettings.userId, userId));
	});

	await rcon.setTradeLock(userId, locked);
	await rcon.alertUser(
		userId,
		locked
			? "Trading has been disabled by staff."
			: "Trading has been re-enabled by staff.",
	);
	if (user.online === "1") {
		await rcon.disconnectUser(userId, user.username);
	}

	await logStaffActivity({
		staffId: staff.id,
		action: locked ? "trade_lock" : "trade_unlock",
		description: locked
			? `Trade-locked ${user.username} (#${userId}) until ${until}`
			: `Cleared trade lock for ${user.username} (#${userId})`,
		targetType: "user",
		targetId: userId,
	});

	return { ok: true as const, data: { userId: id, untilUnix: until } };
}
