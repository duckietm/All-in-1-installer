import { after } from "next/server";
import { apiError, apiOk } from "@/lib/api";
import { db, ItemsBase } from "@/lib/db";
import { getRequestId } from "@/lib/foundation/request-context";
import type { ImportJob, ImportJobItem } from "@/lib/furni/import-job";
import { validateClassnames } from "@/lib/furni/studio-inspection";
import { redis } from "@/lib/redis";
import { fetchSourceFurnidata } from "./clone-import";
import { listSources } from "./clone-sources";
import { ImportJobStore, validJobId } from "./furni-job-store";
import { drainFurnitureImports } from "./furni-job-worker";
import { getOfficialHabboFurnidata } from "./habbo-furnidata-cache";

export async function enqueueFurnitureSync(
	request: Request,
	userId: number,
	kind: "official" | "clone",
) {
	const body = await request.json().catch(() => null);
	if (
		!validJobId(body?.id) ||
		(kind === "official" && body.sourceId !== undefined) ||
		(body.sourceId !== undefined &&
			(typeof body.sourceId !== "string" || body.sourceId.length > 100))
	)
		return apiError("Invalid synchronization request", 400);
	const store = new ImportJobStore();
	const existing = await store.read(body.id).catch((error) => {
		if (error.code === "ENOENT") return null;
		throw error;
	});
	if (existing) {
		if (
			existing.userId !== userId ||
			existing.syncKind !== kind ||
			existing.sourceId !== body.sourceId
		)
			return apiError("Request ID already used", 409);
		after(drainFurnitureImports);
		return apiOk({ job: existing });
	}
	if (!redis || (await redis.ping().catch(() => null)) !== "PONG")
		return apiError("Background import queue is temporarily unavailable", 503);
	const have = new Set(
		(await db.select({ name: ItemsBase.itemName }).from(ItemsBase)).map(
			(row) => row.name,
		),
	);
	const items = new Map<string, ImportJobItem>();
	if (kind === "official") {
		for (const entry of (await getOfficialHabboFurnidata()).values()) {
			if (have.has(entry.classname)) continue;
			items.set(entry.classname, {
				id: 0,
				classname: entry.classname,
				name: entry.name,
				description: entry.description ?? "",
				type: entry.category === "wallitem" ? "wallitem" : "flooritem",
				revision: entry.revision ?? 0,
				category: entry.category ?? "unknown",
			});
		}
	} else {
		const sources = (await listSources()).filter(
			(source) => !body.sourceId || source.id === body.sourceId,
		);
		if (!sources.length) return apiError("No sources configured", 400);
		// Discovery is read-only. Persist one complete snapshot, never a partial request.
		for (const source of sources)
			for (const entry of await fetchSourceFurnidata(source.furnidataUrl)) {
				if (have.has(entry.classname) || items.has(entry.classname)) continue;
				items.set(entry.classname, {
					id: entry.id,
					classname: entry.classname,
					name: entry.name,
					description: entry.description,
					type: entry.itemType === "i" ? "wallitem" : "flooritem",
					revision: Number(entry.revision) || 0,
					category: String(entry.category ?? "unknown"),
					cloneSourceId: source.id,
					cloneEntry: entry,
				});
			}
	}
	if (items.size > (kind === "official" ? 500 : 2000))
		return apiError(
			"Too many missing items. Import a smaller selection from Studio.",
			400,
		);
	if ([...items.keys()].some((classname) => !validateClassnames([classname])))
		return apiError("Source contains invalid furniture identifiers", 400);
	const now = new Date().toISOString();
	const job: ImportJob = {
		id: body.id,
		userId,
		syncKind: kind,
		operationId: getRequestId(),
		sourceId: body.sourceId,
		translate: false,
		createdAt: now,
		updatedAt: now,
		state: items.size ? "queued" : "completed",
		items: [...items.values()].map((item) => ({ ...item, state: "pending" })),
	};
	const saved = await store.create(job);
	if (
		saved.userId !== userId ||
		saved.syncKind !== kind ||
		saved.sourceId !== body.sourceId
	)
		return apiError("Request ID already used", 409);
	after(drainFurnitureImports);
	return apiOk({ job: saved });
}
