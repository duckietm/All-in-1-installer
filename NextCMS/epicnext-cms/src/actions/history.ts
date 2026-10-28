"use server";
import { revalidatePath } from "next/cache";
import { sendCatalogUpdate } from "@/features/catalog/server/sync-status";
import { historyChanges, sameSnapshot } from "@/features/history/model";
import {
	applyHistory,
	historySnapshot,
	readHistory,
} from "@/features/history/server";
import { requirePermission } from "@/lib/admin/guard";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";
import { withCatalogExport } from "@/lib/services/catalog-git-queue";
import { invalidateNewsCache } from "@/lib/services/news-cache";

async function authorized(id: number) {
	await requirePermission(PERMS.LOGS_VIEW);
	if (!Number.isSafeInteger(id) || id < 1) throw Error("unavailable");
	const entry = await db.transaction((tx) => readHistory(tx, id));
	const staff = await requirePermission(
		entry.kind === "news" ? PERMS.NEWS_EDIT : PERMS.CATALOG_EDIT,
	);
	return { entry, staff };
}
export async function previewHistoryRestore(id: number) {
	const { entry } = await authorized(id);
	return db.transaction(async (tx) => {
		const current = await historySnapshot(tx, entry.kind, entry.targetId);
		return {
			canRestore: sameSnapshot(current, entry.after),
			changes: historyChanges(current, entry.before),
		};
	});
}
export async function restoreHistory(id: number) {
	const { entry, staff } = await authorized(id);
	try {
		const restore = () =>
			db.transaction((tx) => applyHistory(tx, entry, staff.id));
		if (entry.kind === "news") await restore();
		else
			await withCatalogExport(async () => {
				await restore();
				return { ok: true as const, data: {} };
			});
	} catch (error) {
		if (error instanceof Error && error.message === "conflict")
			return { ok: false as const, code: "conflict" as const };
		logger.error("History restore failed", { module: "history", error });
		return { ok: false as const, code: "failed" as const };
	}
	try {
		if (entry.kind === "news") {
			await invalidateNewsCache();
			revalidatePath("/news", "layout");
			revalidatePath("/admin/articles", "layout");
			revalidatePath("/");
			revalidatePath("/me");
		} else {
			await sendCatalogUpdate();
			revalidatePath("/admin/catalog", "layout");
		}
	} catch (error) {
		logger.error("History refresh failed", { module: "history", error });
	}
	revalidatePath("/admin/logs/audit");
	return { ok: true as const };
}
