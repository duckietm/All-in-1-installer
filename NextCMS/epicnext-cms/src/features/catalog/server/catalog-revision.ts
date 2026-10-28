import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "@/lib/logger";
import { catalogStateRoot } from "@/lib/services/catalog-git-config";

const FILE = "catalog-revision.json";

/**
 * A cheap "did the catalog change?" token for every open admin session.
 *
 * `sendCatalogUpdate()` runs after each catalog write, so bumping this there
 * covers every import, page edit, item edit and organize run without touching
 * each call site. Clients compare the revision they loaded against the current
 * one to decide whether their tree is stale: one tiny file read instead of
 * re-reading the whole tree every few seconds.
 *
 * The value is random rather than a counter. Two CMS processes writing at the
 * same moment must never hand out the same revision, and consumers only ever
 * compare for inequality, so a monotonic number would buy nothing.
 *
 * Like the totals cache this only tracks writes made through the CMS. A direct
 * database edit leaves the revision untouched, which is exactly when a reload
 * is warranted anyway.
 */
export async function bumpCatalogRevision(): Promise<string> {
	const revision = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
	const root = catalogStateRoot();
	const temp = path.join(root, `revision-${randomUUID()}.tmp`);
	try {
		await fs.mkdir(root, { recursive: true });
		await fs.writeFile(temp, JSON.stringify({ revision }), { flag: "wx" });
		await fs.rename(temp, path.join(root, FILE));
	} catch (error) {
		logger.error("Cannot persist catalog revision", {
			module: "catalog",
			error,
		});
	} finally {
		await fs.rm(temp, { force: true }).catch(() => {});
	}
	return revision;
}

export async function readCatalogRevision(): Promise<string | null> {
	try {
		const parsed = JSON.parse(
			await fs.readFile(path.join(catalogStateRoot(), FILE), "utf8"),
		) as { revision?: unknown };
		return typeof parsed.revision === "string" ? parsed.revision : null;
	} catch (error) {
		// A missing file means "no revision yet", which every client reads as
		// stale — the correct answer on a fresh install.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		logger.error("Cannot read catalog revision", {
			module: "catalog",
			error,
		});
		return null;
	}
}
