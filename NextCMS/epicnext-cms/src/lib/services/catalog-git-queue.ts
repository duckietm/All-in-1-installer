import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";
import {
	catalogStateRoot,
	readManagedCatalogConfig,
} from "./catalog-git-config";
import { CatalogExportQueue } from "./catalog-git-core";

export function catalogExportEnabled() {
	const config = readManagedCatalogConfig();
	return config
		? config.enabled
		: Boolean(process.env.CATALOG_GIT_CHECKOUT?.trim());
}
export function catalogExportQueue() {
	return new CatalogExportQueue(catalogStateRoot());
}
export function isCatalogMutation(method: string, pathname: string) {
	return (
		["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
		pathname.replace(/\/$/, "") !== "/api/admin/catalog/status" &&
		(pathname.startsWith("/api/admin/import/") ||
			pathname.startsWith("/api/admin/catalog/") ||
			pathname.startsWith("/api/admin/furni/") ||
			pathname.startsWith("/api/admin/furniture/"))
	);
}
export async function catalogExportStatus() {
	const q = catalogExportQueue();
	if (!catalogExportEnabled()) return { enabled: false, pending: 0, active: 0 };
	const entries = await q.entries();
	let last: { commit?: string; finishedAt?: string; error?: string } = {};
	try {
		last = JSON.parse(
			await fs.readFile(path.join(q.root, "status.json"), "utf8"),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return {
		enabled: true,
		pending: entries.filter((f) => f.endsWith(".pending")).length,
		active: entries.filter((f) => f.endsWith(".active")).length,
		running: entries.includes("worker.lock"),
		...last,
	};
}

export async function withCatalogExport<T>(
	operation: () => Promise<T>,
): Promise<T> {
	if (!catalogExportEnabled()) return operation();
	const finish = await beginCatalogExport();
	try {
		return await operation();
	} finally {
		try {
			await finish();
		} catch (error) {
			logger.error("Catalog operation finished but export scheduling failed", {
				module: "catalog",
				error,
			});
		}
	}
}

export async function scheduleCatalogExport() {
	if (!readManagedCatalogConfig()?.enabled) return;
	try {
		const { after } = await import("next/server");
		after(async () => {
			const { runCatalogExport } = await import("./catalog-git-export");
			await runCatalogExport();
			// Catalog + furnidata (gamedata) zijn net vers verwerkt: laat de
			// Cloudflare edge-cache van die tags los. Fire-and-forget en
			// no-op zonder token; s-maxage blijft de fallback.
			const { EDGE_CACHE_TAGS, purgeEdgeCache } = await import(
				"@/lib/edge-cache"
			);
			void purgeEdgeCache(
				[EDGE_CACHE_TAGS.public, EDGE_CACHE_TAGS.gamedata],
				"catalog-export",
			);
		});
	} catch {
		/* Standalone worker contexts use their scheduled retry. */
	}
}
export async function beginCatalogExport() {
	const finish = await catalogExportQueue().begin();
	return async () => {
		await finish();
		await scheduleCatalogExport();
	};
}
