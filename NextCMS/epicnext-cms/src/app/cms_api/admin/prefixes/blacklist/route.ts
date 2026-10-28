import { sql } from "drizzle-orm";
import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { db, queryRows } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

interface BlacklistWord {
	id: number;
	word: string;
}

export const GET = withAdmin({ permission: PERMS.PREFIXES_VIEW }, async () => {
	const words = await queryRows<BlacklistWord>(
		sql`SELECT id, word FROM custom_prefix_blacklist ORDER BY word ASC`,
	);

	return apiOk({ words });
});

export const POST = withAdmin(
	{ permission: PERMS.PREFIXES_EDIT },
	async (request) => {
		const body = await request.json();
		const word = typeof body.word === "string" ? body.word.trim() : "";

		if (!word) return apiError("Word is required");

		await db.execute(
			sql`INSERT INTO custom_prefix_blacklist (word) VALUES (${word})`,
		);

		return apiOk();
	},
);

export const DELETE = withAdmin(
	{ permission: PERMS.PREFIXES_EDIT },
	async (request) => {
		const body = await request.json();
		const id = Number(body.id);

		if (!Number.isInteger(id) || id <= 0)
			return apiError("Missing or invalid word id");

		await db.execute(sql`DELETE FROM custom_prefix_blacklist WHERE id = ${id}`);

		return apiOk({ deleted: id });
	},
);
