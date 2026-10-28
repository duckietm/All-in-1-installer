import { eq } from "drizzle-orm";
import { db, ItemsBase } from "@/lib/db";
import type { ImportJobItem } from "@/lib/furni/import-job";
import { cloneSingleFurni } from "./clone-import";
import { getSource } from "./clone-sources";
import { importSingleFurni } from "./furni-import";

/** Called only inside the shared import lease and catalog export lock. */
export async function runSyncJobItem(
	item: ImportJobItem,
	onProgress?: (status: string) => void | Promise<void>,
) {
	const [existing] = await db
		.select({ id: ItemsBase.id })
		.from(ItemsBase)
		.where(eq(ItemsBase.itemName, item.classname))
		.limit(1);
	if (existing)
		return {
			ok: true,
			itemId: existing.id,
			warnings: ["Already present; synchronization skipped this item."],
		};
	if (item.cloneSourceId) {
		const source = await getSource(item.cloneSourceId);
		if (!source || !item.cloneEntry)
			throw Error("Synchronization source no longer available");
		const result = await cloneSingleFurni({
			source,
			entry: item.cloneEntry,
			onProgress,
		});
		const [created] = result.ok
			? await db
					.select({ id: ItemsBase.id })
					.from(ItemsBase)
					.where(eq(ItemsBase.itemName, item.classname))
					.limit(1)
			: [];
		return { ...result, itemId: created?.id };
	}
	return importSingleFurni({ ...item, repairExisting: false, onProgress });
}
