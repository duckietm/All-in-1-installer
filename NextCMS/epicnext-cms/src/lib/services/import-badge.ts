import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db, WebsiteBadges } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getGamedataRoot } from "@/lib/services/furni-asset-dirs";
import { getRuntimePath } from "@/lib/utils/runtime-path";

export type ImportBadgeResult =
	| { ok: true }
	| { ok: false; error: string; status: number };

function externalTextsPath(gamedataRoot: string): string {
	return getRuntimePath(gamedataRoot, "config", "ExternalTexts.json");
}

/** Write badge name/desc into ExternalTexts.json (409 if already present). */
export async function writeBadgeToExternalTexts(
	code: string,
	name: string,
	description: string,
): Promise<ImportBadgeResult> {
	const gamedataRoot = await getGamedataRoot();
	if (!gamedataRoot) {
		return {
			ok: false,
			error: "gamedata_root not configured",
			status: 500,
		};
	}
	const extPath = externalTextsPath(gamedataRoot);
	const nameKey = `badge_name_${code}`;
	const descKey = `badge_desc_${code}`;

	let texts: Record<string, string>;
	try {
		const raw = await fs.readFile(extPath, "utf-8");
		texts = JSON.parse(raw) as Record<string, string>;
	} catch (err) {
		// File not present yet (fresh deployment) — start with an empty object.
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			logger.warn(
				`[import-badges] Failed to update ExternalTexts.json: ${(err as Error).message}`,
			);
			return {
				ok: false,
				error: "Failed to update ExternalTexts.json",
				status: 500,
			};
		}
		texts = {};
	}

	if (texts[nameKey] !== undefined) {
		return {
			ok: false,
			error: "Badge already exists in ExternalTexts.json",
			status: 409,
		};
	}

	texts[nameKey] = name;
	texts[descKey] = description || "";

	try {
		await fs.mkdir(path.dirname(extPath), { recursive: true });
		await fs.writeFile(extPath, JSON.stringify(texts, null, 4), "utf-8");
		return { ok: true };
	} catch (err) {
		logger.warn(
			`[import-badges] Failed to update ExternalTexts.json: ${(err as Error).message}`,
		);
		return {
			ok: false,
			error: "Failed to update ExternalTexts.json",
			status: 500,
		};
	}
}

/** Upsert WebsiteBadges row so CMS badge tables stay in sync. */
export async function upsertWebsiteBadge(
	code: string,
	name: string,
	description: string,
): Promise<void> {
	const now = new Date();
	await db
		.insert(WebsiteBadges)
		.values({
			badgeKey: code,
			badgeName: name,
			badgeDescription: description,
			createdAt: now,
			updatedAt: now,
		})
		.onDuplicateKeyUpdate({
			set: {
				badgeName: name,
				badgeDescription: description,
				updatedAt: now,
			},
		});
}

/**
 * Single import path: ExternalTexts.json + WebsiteBadges.
 * Callers should gate with ASSETS_IMPORT.
 */
export async function importBadgeSynced(input: {
	code: string;
	name: string;
	description: string;
}): Promise<ImportBadgeResult> {
	const texts = await writeBadgeToExternalTexts(
		input.code,
		input.name,
		input.description,
	);
	if (!texts.ok) return texts;

	try {
		await upsertWebsiteBadge(input.code, input.name, input.description);
	} catch {
		return { ok: false, error: "Failed to import badge", status: 500 };
	}

	return { ok: true };
}
