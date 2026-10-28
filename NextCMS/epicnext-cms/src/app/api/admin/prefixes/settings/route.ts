import { sql } from "drizzle-orm";
import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { db, queryRows } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

interface PrefixSetting {
	key: string;
	value: string;
}

const VALID_KEYS = new Set([
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

const DEFAULT_SETTINGS: Record<string, string> = {
	max_length: "15",
	min_rank_to_buy: "1",
	price_credits: "5",
	price_points: "0",
	points_type: "0",
};

export const GET = withAdmin({ permission: PERMS.PREFIXES_VIEW }, async () => {
	const settings = await queryRows<PrefixSetting>(
		sql`SELECT \`key\`, \`value\` FROM custom_prefix_settings`,
	);

	const result: Record<string, string> = { ...DEFAULT_SETTINGS };
	for (const s of settings) {
		result[s.key] = s.value;
	}

	return apiOk({ settings: result });
});

export const PUT = withAdmin(
	{ permission: PERMS.PREFIXES_EDIT },
	async (request) => {
		const body = await request.json();
		const settings = body.settings;

		if (!settings || typeof settings !== "object") {
			return apiError("Settings object is required");
		}

		for (const [key, value] of Object.entries(settings)) {
			if (!VALID_KEYS.has(key)) {
				return apiError(`Invalid setting key: ${key}`);
			}
			const strValue = String(value);
			await db.execute(sql`
      INSERT INTO custom_prefix_settings (\`key\`, \`value\`)
      VALUES (${key}, ${strValue})
      ON DUPLICATE KEY UPDATE \`value\` = ${strValue}
    `);
		}

		return apiOk();
	},
);
