import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "@/lib/logger";
import { catalogStateRoot } from "@/lib/services/catalog-git-config";
import { rcon } from "@/lib/services/rcon";
import { bumpCatalogRevision } from "./catalog-revision";
import { invalidateCatalogTotals } from "./catalog-totals";
export interface CatalogHotelStatus {
	sent: boolean;
	checkedAt: string;
	reference?: string;
}

/** How many deliveries the history file keeps before dropping the oldest. */
const HISTORY_LIMIT = 50;
const HISTORY_FILE = "hotel-status-history.json";

export async function readCatalogHotelStatus(): Promise<CatalogHotelStatus | null> {
	try {
		return JSON.parse(
			await fs.readFile(
				path.join(catalogStateRoot(), "hotel-status.json"),
				"utf8",
			),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/**
 * The last delivery is not the same question as "which imports reached the
 * hotel". `hotel-status.json` answers the first and overwrites itself on every
 * write, so a failure two imports ago is gone by the time anyone looks. This
 * keeps a bounded tail instead, newest first.
 */
export async function readCatalogHotelHistory(): Promise<CatalogHotelStatus[]> {
	try {
		const parsed: unknown = JSON.parse(
			await fs.readFile(path.join(catalogStateRoot(), HISTORY_FILE), "utf8"),
		);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(entry): entry is CatalogHotelStatus =>
				!!entry &&
				typeof entry === "object" &&
				typeof (entry as CatalogHotelStatus).checkedAt === "string" &&
				typeof (entry as CatalogHotelStatus).sent === "boolean",
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

async function appendHotelHistory(status: CatalogHotelStatus): Promise<void> {
	const root = catalogStateRoot();
	try {
		await fs.mkdir(root, { recursive: true });
		const file = path.join(root, HISTORY_FILE);
		let previous: CatalogHotelStatus[] = [];
		try {
			const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
			if (Array.isArray(parsed)) previous = parsed as CatalogHotelStatus[];
		} catch (error) {
			// A corrupt history must not stop the delivery itself; the snapshot
			// below is still written either way.
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") previous = [];
		}
		const next = [status, ...previous].slice(0, HISTORY_LIMIT);
		const temp = path.join(root, `hotel-history-${randomUUID()}.tmp`);
		try {
			await fs.writeFile(temp, JSON.stringify(next), { flag: "wx" });
			await fs.rename(temp, file);
		} finally {
			await fs.rm(temp, { force: true }).catch(() => {});
		}
	} catch (error) {
		logger.error("Cannot append catalog hotel update history", {
			module: "catalog",
			error,
		});
	}
}
/** An acknowledged socket write is an update request, not proof of client application. */
export async function sendCatalogUpdate(): Promise<CatalogHotelStatus> {
	let sent = false;
	let reference: string | undefined;
	try {
		sent = await rcon.updateCatalog();
		if (!sent)
			reference = logger.error(
				"Catalog saved; hotel update was not delivered",
				{ module: "catalog" },
			);
	} catch (error) {
		reference = logger.error("Catalog saved; hotel update failed", {
			module: "catalog",
			error,
		});
	}
	// Callers reach here only after writing catalog rows, so the admin stats
	// totals must not keep serving the pre-write numbers from their 30s cache.
	invalidateCatalogTotals();
	// Every catalog write lands here, which makes this the one place that can
	// tell open admin sessions their tree is stale — including writes made by a
	// different tab, browser or process than the one watching.
	await bumpCatalogRevision();
	const status = { sent, checkedAt: new Date().toISOString(), reference };
	await appendHotelHistory(status);
	const root = catalogStateRoot();
	const temp = path.join(root, `hotel-${randomUUID()}.tmp`);
	try {
		await fs.mkdir(root, { recursive: true });
		await fs.writeFile(temp, JSON.stringify(status), { flag: "wx" });
		await fs.rename(temp, path.join(root, "hotel-status.json"));
	} catch (error) {
		logger.error("Cannot persist catalog hotel update status", {
			module: "catalog",
			error,
		});
	} finally {
		await fs.rm(temp, { force: true }).catch(() => {});
	}
	return status;
}
