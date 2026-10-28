"use server";

import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isDynamicSuperAdmin } from "@/lib/admin/authorization-policy";
import { guardRank } from "@/lib/admin/rank-guard";
import { invalidateLoginCache } from "@/lib/auth";
import { hashPassword } from "@/lib/auth/password";
import { revokeUserCredentials } from "@/lib/auth/session-revocation";
import {
	Ban,
	db,
	User,
	UsersBadges,
	UsersCurrency,
	UsersSettings,
} from "@/lib/db";
import { getHighestRank, PERMS } from "@/lib/permissions";
import { adminAction } from "@/lib/safe-action";
import { ActionError, actionOk } from "@/lib/safe-action-shared";
import { logAudit } from "@/lib/services/audit";
import { rcon } from "@/lib/services/rcon";
import { notify } from "@/lib/services/webhook";
import {
	banUserSchema,
	createUserSchema,
	giveBadgeSchema,
	updateUserSchema,
} from "@/lib/validators/user";

const DEFAULT_LOOK =
	"hr-115-42.hd-195-19.ch-3030-82.lg-275-1408.fa-1201.ca-1804-64";

function isDuplicateKey(err: unknown): boolean {
	if (!err || typeof err !== "object") return false;
	const e = err as { code?: string | number; errno?: number };
	return e.code === "P2002" || e.code === "ER_DUP_ENTRY" || e.errno === 1062;
}

function duplicateField(err: unknown): "username" | "mail" | null {
	if (!isDuplicateKey(err)) return null;
	const e = err as {
		message?: string;
		meta?: { target?: string[] };
	};
	const target = e.meta?.target ?? [];
	if (target.includes("username")) return "username";
	if (target.includes("mail")) return "mail";
	const msg = e.message ?? "";
	if (msg.includes("username")) return "username";
	if (msg.includes("mail")) return "mail";
	return null;
}

export const createUser = adminAction(
	{ permission: PERMS.USERS_EDIT, schema: createUserSchema },
	async (ctx) => {
		const { username, mail, password, rank, motto } = ctx.data;
		const actorRank = ctx.session.user.rank;
		const highestRank = await getHighestRank();
		if (rank >= actorRank && !isDynamicSuperAdmin(actorRank, highestRank)) {
			throw new ActionError("Cannot assign rank equal or higher than your own");
		}

		const hashedPassword = await hashPassword(password);
		const now = Math.floor(Date.now() / 1000);

		try {
			const user = await db.transaction(async (tx) => {
				const [result] = await tx.insert(User).values({
					username,
					mail,
					password: hashedPassword,
					rank,
					motto: motto || "I'm new here!",
					look: DEFAULT_LOOK,
					credits: 5000,
					pixels: 5000,
					accountCreated: now,
					ipRegister: "0.0.0.0",
					ipCurrent: "0.0.0.0",
				});
				const id = Number(result.insertId);

				await tx.insert(UsersSettings).values({ userId: id });
				await tx.insert(UsersCurrency).values([
					{ userId: id, type: 0, amount: 5000 },
					{ userId: id, type: 5, amount: 5000 },
				]);

				return { id, username };
			});

			logAudit({
				userId: ctx.session.user.id,
				action: "user_create",
				target: "User",
				targetId: user.id,
				after: { username, mail, rank },
			});

			notify({
				action: "user_create",
				actor: ctx.session.user.username,
				target: username,
				targetId: user.id,
				details: "Account created by admin",
			});

			return actionOk({ id: user.id, username: user.username });
		} catch (err) {
			const field = duplicateField(err);
			if (field === "username") throw new ActionError("Username already taken");
			if (field === "mail") throw new ActionError("Email already registered");
			if (isDuplicateKey(err))
				throw new ActionError("Username or email already in use");
			throw err;
		}
	},
);

const updateUserInput = updateUserSchema.extend({
	id: z.coerce.number().int().positive(),
});

export const updateUser = adminAction(
	{ permission: PERMS.USERS_EDIT, schema: updateUserInput },
	async (ctx) => {
		const { id, diamonds, duckets, ...userData } = ctx.data;

		const targetUser = await guardRank(id, ctx.session.user.rank);

		if (
			userData.rank !== undefined &&
			userData.rank >= ctx.session.user.rank &&
			!isDynamicSuperAdmin(ctx.session.user.rank, await getHighestRank())
		) {
			throw new ActionError("Cannot assign rank equal or higher than your own");
		}

		const patch = Object.fromEntries(
			Object.entries(userData).filter(([, v]) => v !== undefined),
		) as Partial<{
			username: string;
			mail: string;
			rank: number;
			motto: string;
			credits: number;
			pixels: number;
			mailVerified?: string;
		}>;
		// A changed address has to prove itself again: leaving mail_verified
		// set would keep every mail send (resets, notifications) pointed at an
		// inbox nobody confirmed, and would silently bypass the "verified
		// accounts only" gate.
		if (patch.mail !== undefined && patch.mail !== targetUser.mail) {
			patch.mailVerified = "0";
		}
		if (Object.keys(patch).length > 0) {
			await db.update(User).set(patch).where(eq(User.id, id));
		}
		invalidateLoginCache(targetUser.username);

		if (diamonds !== undefined) {
			await db
				.insert(UsersCurrency)
				.values({ userId: id, type: 5, amount: diamonds })
				.onDuplicateKeyUpdate({ set: { amount: diamonds } });
		}
		if (duckets !== undefined) {
			await db
				.insert(UsersCurrency)
				.values({ userId: id, type: 0, amount: duckets })
				.onDuplicateKeyUpdate({ set: { amount: duckets } });
		}

		logAudit({
			userId: ctx.session.user.id,
			action: "user_edit",
			target: "User",
			targetId: id,
			before: {
				username: targetUser.username,
				mail: targetUser.mail,
				rank: targetUser.rank,
			},
			after: userData,
		});

		notify({
			action: "user_edit",
			actor: ctx.session.user.username,
			target: targetUser.username,
			targetId: id,
		});

		return actionOk();
	},
);

const banInput = banUserSchema.extend({});

export const banUser = adminAction(
	{ permission: PERMS.USERS_BAN, schema: banInput },
	async (ctx) => {
		const { userId, reason, duration, type, ip } = ctx.data;

		const targetUser = await guardRank(userId, ctx.session.user.rank);

		const now = Math.floor(Date.now() / 1000);
		const banExpire = duration > 0 ? now + duration * 3600 : 0;

		await db.insert(Ban).values({
			userId,
			userStaffId: ctx.session.user.id,
			timestamp: now,
			banExpire,
			banReason: reason,
			type: type || "account",
			ip: ip || "",
			machineId: "",
		});

		// The ban also ends the CMS sessions, API tokens and game SSO ticket the user has.
		await revokeUserCredentials(userId);
		await rcon.disconnectUser(userId);

		logAudit({
			userId: ctx.session.user.id,
			action: "ban",
			target: "User",
			targetId: userId,
			after: { reason, type, duration },
		});

		notify({
			action: "ban",
			actor: ctx.session.user.username,
			target: targetUser.username,
			details: reason,
		});

		return actionOk();
	},
);

const unbanInput = z.object({ userId: z.coerce.number().int().positive() });

export const unbanUser = adminAction(
	{ permission: PERMS.USERS_BAN, schema: unbanInput },
	async (ctx) => {
		const { userId } = ctx.data;

		const targetUser = await guardRank(userId, ctx.session.user.rank);

		await db.delete(Ban).where(eq(Ban.userId, userId));

		logAudit({
			userId: ctx.session.user.id,
			action: "unban",
			target: "User",
			targetId: userId,
		});

		notify({
			action: "unban",
			actor: ctx.session.user.username,
			target: targetUser.username,
		});

		return actionOk();
	},
);

export const giveBadge = adminAction(
	{ permission: PERMS.USERS_EDIT, schema: giveBadgeSchema },
	async (ctx) => {
		const { userId, badgeCode } = ctx.data;

		await guardRank(userId, ctx.session.user.rank);

		const [existing] = await db
			.select({ id: UsersBadges.id })
			.from(UsersBadges)
			.where(
				and(
					eq(UsersBadges.userId, userId),
					eq(UsersBadges.badgeCode, badgeCode),
				),
			)
			.limit(1);
		if (existing) throw new ActionError("Badge already assigned");

		await db.insert(UsersBadges).values({ userId, badgeCode });
		await rcon.giveBadge(userId, badgeCode);

		return actionOk();
	},
);

// ── Remove Badge ────────────────────────────────────────────────────

const removeBadgeSchema = z.object({
	userId: z.coerce.number().int().positive(),
	badgeCode: z.string().min(1),
});

export const removeBadge = adminAction(
	{ permission: PERMS.USERS_EDIT, schema: removeBadgeSchema },
	async (ctx) => {
		const { userId, badgeCode } = ctx.data;

		await guardRank(userId, ctx.session.user.rank);

		const [existing] = await db
			.select({ id: UsersBadges.id })
			.from(UsersBadges)
			.where(
				and(
					eq(UsersBadges.userId, userId),
					eq(UsersBadges.badgeCode, badgeCode),
				),
			)
			.limit(1);
		if (!existing) throw new ActionError("Badge not found");

		await db.delete(UsersBadges).where(eq(UsersBadges.id, existing.id));
		await rcon.removeBadge(userId, badgeCode);

		return actionOk();
	},
);

// ── Reset Password ──────────────────────────────────────────────────

const resetPasswordSchema = z.object({
	userId: z.coerce.number().int().positive(),
});

export const resetPassword = adminAction(
	{ permission: PERMS.USERS_RESET_PASSWORD, schema: resetPasswordSchema },
	async (ctx) => {
		const target = await guardRank(ctx.data.userId, ctx.session.user.rank);

		const newPassword = crypto
			.randomBytes(12)
			.toString("base64url")
			.slice(0, 16);
		const hashed = await hashPassword(newPassword);

		await db
			.update(User)
			.set({ password: hashed })
			.where(eq(User.id, ctx.data.userId));
		// A staff-issued password must also end the user's live sessions: this
		// action exists precisely for "account compromised" situations.
		await revokeUserCredentials(ctx.data.userId);
		invalidateLoginCache(target.username);

		logAudit({
			userId: ctx.session.user.id,
			action: "reset_password",
			target: "User",
			targetId: ctx.data.userId,
		});

		notify({
			action: "user_edit",
			actor: ctx.session.user.username,
			target: target.username,
			details: "Password reset",
		});

		return actionOk({ newPassword });
	},
);

// ── Disconnect User ─────────────────────────────────────────────────

const disconnectSchema = z.object({
	userId: z.coerce.number().int().positive(),
});

export const disconnectUser = adminAction(
	{ permission: PERMS.USERS_EDIT, schema: disconnectSchema },
	async (ctx) => {
		const target = await guardRank(ctx.data.userId, ctx.session.user.rank);
		const success = await rcon.disconnectUser(ctx.data.userId);
		if (!success)
			throw new ActionError("Failed to disconnect. Is the emulator running?");

		logAudit({
			userId: ctx.session.user.id,
			action: "user_disconnect",
			target: "User",
			targetId: ctx.data.userId,
		});

		notify({
			action: "disconnect",
			actor: ctx.session.user.username,
			target: target.username,
		});

		return actionOk();
	},
);

// ── Alert User (in-game message) ────────────────────────────────────

const alertUserSchema = z.object({
	userId: z.coerce.number().int().positive(),
	message: z.string().min(1).max(500),
});

export const alertUser = adminAction(
	{ permission: PERMS.USERS_EDIT, schema: alertUserSchema },
	async (ctx) => {
		const target = await guardRank(ctx.data.userId, ctx.session.user.rank);
		const success = await rcon.alertUser(ctx.data.userId, ctx.data.message);
		if (!success)
			throw new ActionError("Failed to send alert. Is the emulator running?");

		logAudit({
			userId: ctx.session.user.id,
			action: "user_alert",
			target: "User",
			targetId: ctx.data.userId,
			after: { message: ctx.data.message, username: target.username },
		});

		return actionOk();
	},
);

// ── Mute User ───────────────────────────────────────────────────────

const muteSchema = z.object({
	userId: z.coerce.number().int().positive(),
	duration: z.coerce.number().int().min(0).default(0),
});

export const muteUser = adminAction(
	{ permission: PERMS.USERS_EDIT, schema: muteSchema },
	async (ctx) => {
		const _target = await guardRank(ctx.data.userId, ctx.session.user.rank);
		void _target;
		const success = await rcon.muteUser(ctx.data.userId, ctx.data.duration);
		if (!success)
			throw new ActionError("Failed to mute. Is the emulator running?");

		logAudit({
			userId: ctx.session.user.id,
			action: "user_mute",
			target: "User",
			targetId: ctx.data.userId,
			after: { duration: ctx.data.duration },
		});

		notify({
			action: "hotel_alert",
			actor: ctx.session.user.username,
			target: _target.username,
			details: "Muted",
		});

		return actionOk();
	},
);

// ── Unmute User ─────────────────────────────────────────────────────

const unmuteSchema = z.object({
	userId: z.coerce.number().int().positive(),
});

export const unmuteUser = adminAction(
	{ permission: PERMS.USERS_EDIT, schema: unmuteSchema },
	async (ctx) => {
		const target = await guardRank(ctx.data.userId, ctx.session.user.rank);
		const success = await rcon.unmuteUser(ctx.data.userId);
		if (!success)
			throw new ActionError("Failed to unmute. Is the emulator running?");

		logAudit({
			userId: ctx.session.user.id,
			action: "user_unmute",
			target: "User",
			targetId: ctx.data.userId,
		});

		notify({
			action: "hotel_alert",
			actor: ctx.session.user.username,
			target: target.username,
			details: "Unmuted",
		});

		return actionOk();
	},
);

// ── Send Credits via RCON ───────────────────────────────────────────

const sendCreditsSchema = z.object({
	userId: z.coerce.number().int().positive(),
	amount: z.coerce.number().int().min(1).max(1000000),
});

export const sendCredits = adminAction(
	{ permission: PERMS.USERS_EDIT, schema: sendCreditsSchema },
	async (ctx) => {
		const _target = await guardRank(ctx.data.userId, ctx.session.user.rank);
		void _target;
		const success = await rcon.giveCredits(ctx.data.userId, ctx.data.amount);
		if (!success)
			throw new ActionError("Failed to send credits. Is the emulator running?");

		logAudit({
			userId: ctx.session.user.id,
			action: "user_send_credits",
			target: "User",
			targetId: ctx.data.userId,
			after: { amount: ctx.data.amount },
		});

		return actionOk();
	},
);
