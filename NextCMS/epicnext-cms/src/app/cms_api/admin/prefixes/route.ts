import { sql } from "drizzle-orm";
import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { db, queryRows } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

interface UserPrefix {
	id: number;
	user_id: number;
	text: string;
	color: string;
	icon: string;
	effect: string;
	active: number;
	username?: string | null;
}

export const GET = withAdmin(
	{ permission: PERMS.PREFIXES_VIEW },
	async (request) => {
		const url = request.nextUrl;
		const q = url.searchParams.get("q") || "";
		const page = Math.max(1, Number(url.searchParams.get("page") || 1));
		const limit = 50;
		const offset = (page - 1) * limit;

		const whereFragment = q
			? sql`WHERE up.text LIKE ${`%${q}%`} OR u.username LIKE ${`%${q}%`}`
			: sql``;

		const prefixes = await queryRows<UserPrefix>(
			sql`SELECT up.id, up.user_id, up.text, up.color, up.icon, up.effect, up.active, u.username
         FROM custom_prefixes up
         LEFT JOIN users u ON u.id = up.user_id
         ${whereFragment}
         ORDER BY up.id DESC
         LIMIT ${limit} OFFSET ${offset}`,
		);

		const countResult = await queryRows<{ total: bigint }>(
			sql`SELECT COUNT(*) as total FROM custom_prefixes up
         LEFT JOIN users u ON u.id = up.user_id
         ${whereFragment}`,
		);

		const total = Number(countResult[0]?.total || 0);

		return apiOk({
			prefixes: prefixes.map((p) => ({
				...p,
				icon: p.icon || "",
				effect: p.effect || "",
				active: Boolean(p.active),
			})),
			total,
			page,
			pages: Math.max(1, Math.ceil(total / limit)),
		});
	},
);

export const POST = withAdmin(
	{ permission: PERMS.PREFIXES_EDIT },
	async (request) => {
		const body = await request.json();
		const { username, text, color, icon, effect, active } = body;

		if (!username || !text || !color) {
			return apiError("Missing required fields: username, text, color");
		}

		const users = await queryRows<{ id: number }>(
			sql`SELECT id FROM users WHERE username = ${username} LIMIT 1`,
		);

		if (!users || users.length === 0) {
			return apiError("User not found");
		}

		const userId = users[0].id;

		await db.execute(
			sql`INSERT INTO custom_prefixes (user_id, text, color, icon, effect, active)
       VALUES (${userId}, ${text}, ${color}, ${icon || ""}, ${effect || ""}, ${active ? 1 : 0})`,
		);

		return apiOk({ created: true });
	},
);

export const PUT = withAdmin(
	{ permission: PERMS.PREFIXES_EDIT },
	async (request) => {
		const body = await request.json();
		const { id, text, color, icon, effect, active } = body;

		if (!id) return apiError("Missing prefix id");

		await db.execute(
			sql`UPDATE custom_prefixes
       SET text = ${text}, color = ${color}, icon = ${icon || ""}, effect = ${effect || ""}, active = ${active ? 1 : 0}
       WHERE id = ${id}`,
		);

		return apiOk({ updated: id });
	},
);

export const DELETE = withAdmin(
	{ permission: PERMS.PREFIXES_EDIT },
	async (request) => {
		const body = await request.json();
		const id = body.id;

		if (!id) return apiError("Missing prefix id");

		await db.execute(sql`DELETE FROM custom_prefixes WHERE id = ${id}`);

		return apiOk({ deleted: id });
	},
);
