import { promises as fs } from "node:fs";
import path from "node:path";
import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { getGamedataRoot } from "@/lib/services/furni-asset-dirs";
import { searchBadges } from "@/lib/services/habboassets";
import { importBadgeSynced } from "@/lib/services/import-badge";

function externalTextsPath(gamedataRoot: string): string {
	return path.join(gamedataRoot, "config", "ExternalTexts.json");
}

// ── Search badges via official Habbo external texts ────────────────
export const GET = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const search = request.nextUrl.searchParams.get("search") || "";
		const offset = parseInt(
			request.nextUrl.searchParams.get("offset") || "0",
			10,
		);
		const allHotels = request.nextUrl.searchParams.get("allHotels") === "1";

		const badges = await searchBadges(
			search,
			100,
			offset,
			allHotels ? null : undefined,
		);

		// Check which badges already exist in ExternalTexts.json
		const existingCodes = new Set<string>();
		try {
			const gamedataRoot = await getGamedataRoot();
			if (gamedataRoot) {
				const raw = await fs.readFile(externalTextsPath(gamedataRoot), "utf-8");
				const texts = JSON.parse(raw);
				for (const badge of badges) {
					if (texts[`badge_name_${badge.code}`] !== undefined) {
						existingCodes.add(badge.code);
					}
				}
			}
		} catch {
			// File not found or invalid - treat all as not imported
		}

		const enriched = badges.map((badge) => ({
			...badge,
			alreadyImported: existingCodes.has(badge.code),
		}));

		return apiOk({ badges: enriched });
	},
);

// ── Import a single badge (ExternalTexts + WebsiteBadges) ───────────
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const body = await request.json();
		const { code, name, description } = body;

		if (!code || !name) return apiError("Missing code or name", 400);

		const result = await importBadgeSynced({
			code,
			name,
			description: description || "",
		});

		if (!result.ok) {
			return apiError(result.error, result.status);
		}

		logAudit({
			userId: ctx.session.user.id,
			action: "badge_import",
			target: "ExternalTexts",
			after: { code, name, description },
		});

		return apiOk();
	},
);
