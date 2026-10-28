"use server";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, User } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { adminAction } from "@/lib/safe-action";
import { ActionError, actionOk } from "@/lib/safe-action-shared";

// Models custom_prefixes / custom_prefix_blacklist / custom_prefix_settings
// are not represented in src/db/schema.ts yet — we use parameterized raw SQL.

// ── Create prefix ───────────────────────────────────────────────────

const createPrefixSchema = z.object({
	username: z.string().min(1),
	text: z.string().min(1),
	color: z.string().min(1),
	icon: z.string().optional(),
	effect: z.string().optional(),
	active: z.coerce.number().int().min(0).max(1).default(1),
});

export const createPrefix = adminAction(
	{ permission: PERMS.PREFIXES_EDIT, schema: createPrefixSchema },
	async (ctx) => {
		const { username, text, color, icon, effect, active } = ctx.data;

		const [user] = await db
			.select({ id: User.id })
			.from(User)
			.where(eq(User.username, username))
			.limit(1);
		if (!user) throw new ActionError("User not found");

		await db.execute(sql`
      INSERT INTO custom_prefixes (user_id, text, color, icon, effect, active)
      VALUES (${user.id}, ${text}, ${color}, ${icon || ""}, ${effect || ""}, ${active})
    `);

		return actionOk();
	},
);

// ── Update prefix ───────────────────────────────────────────────────

const updatePrefixSchema = z.object({
	id: z.coerce.number().int().positive(),
	text: z.string().min(1),
	color: z.string().min(1),
	icon: z.string().optional(),
	effect: z.string().optional(),
	active: z.coerce.number().int().min(0).max(1).optional(),
});

export const updatePrefix = adminAction(
	{ permission: PERMS.PREFIXES_EDIT, schema: updatePrefixSchema },
	async (ctx) => {
		const { id, text, color, icon, effect, active } = ctx.data;

		await db.execute(sql`
      UPDATE custom_prefixes
      SET text = ${text}, color = ${color}, icon = ${icon || ""}, effect = ${effect || ""}, active = ${active ?? 1}
      WHERE id = ${id}
    `);

		return actionOk();
	},
);

// ── Delete prefix ───────────────────────────────────────────────────

const deletePrefixSchema = z.object({
	id: z.coerce.number().int().positive(),
});

export const deletePrefix = adminAction(
	{ permission: PERMS.PREFIXES_EDIT, schema: deletePrefixSchema },
	async (ctx) => {
		await db.execute(
			sql`DELETE FROM custom_prefixes WHERE id = ${ctx.data.id}`,
		);
		return actionOk();
	},
);

// ── Add blacklist word ──────────────────────────────────────────────

const addBlacklistWordSchema = z.object({
	word: z.string().min(1).max(100),
});

export const addBlacklistWord = adminAction(
	{ permission: PERMS.PREFIXES_EDIT, schema: addBlacklistWordSchema },
	async (ctx) => {
		await db.execute(sql`
      INSERT INTO custom_prefix_blacklist (word) VALUES (${ctx.data.word.trim()})
    `);
		return actionOk();
	},
);

// ── Remove blacklist word ───────────────────────────────────────────

const removeBlacklistWordSchema = z.object({
	id: z.coerce.number().int().positive(),
});

export const removeBlacklistWord = adminAction(
	{ permission: PERMS.PREFIXES_EDIT, schema: removeBlacklistWordSchema },
	async (ctx) => {
		await db.execute(
			sql`DELETE FROM custom_prefix_blacklist WHERE id = ${ctx.data.id}`,
		);
		return actionOk();
	},
);

// ── Update prefix settings ──────────────────────────────────────────

const SETTINGS_WHITELIST = new Set([
	"enabled",
	"max_length",
	"min_rank",
	"min_rank_to_buy",
	"allow_colors",
	"allow_bold",
	"allow_italic",
	"default_color",
	"price_credits",
	"price_points",
	"points_type",
]);

const updatePrefixSettingsSchema = z.object({
	settings: z.record(z.string(), z.string()),
});

export const updatePrefixSettings = adminAction(
	{ permission: PERMS.PREFIXES_EDIT, schema: updatePrefixSettingsSchema },
	async (ctx) => {
		for (const [key, value] of Object.entries(ctx.data.settings)) {
			if (!SETTINGS_WHITELIST.has(key)) continue;
			await db.execute(sql`
        INSERT INTO custom_prefix_settings (\`key\`, \`value\`)
        VALUES (${key}, ${value})
        ON DUPLICATE KEY UPDATE \`value\` = ${value}
      `);
		}
		return actionOk();
	},
);
