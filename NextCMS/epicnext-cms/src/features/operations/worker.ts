import "server-only";
import { sendCatalogUpdate } from "@/features/catalog/server/sync-status";
import { logger } from "@/lib/logger";
import {
	catalogExportEnabled,
	catalogExportQueue,
} from "@/lib/services/catalog-git-queue";
import { refreshNewsCacheForDelivery } from "@/lib/services/news-cache";
import { dispatchEffects } from "./dispatcher";
import { effectRepository } from "./server";

let running = false;
export async function drainOperationEffects() {
	if (running) return;
	running = true;
	try {
		await dispatchEffects(effectRepository, async (claim) => {
			if (claim.topic === "catalog.refresh") {
				if (!(await sendCatalogUpdate()).sent)
					throw new Error("Hotel update not delivered");
			} else if (claim.topic === "catalog.export.request") {
				if (catalogExportEnabled()) await catalogExportQueue().request();
			} else if (claim.topic === "news.refresh") {
				await refreshNewsCacheForDelivery();
			} else throw new Error("Unknown delivery topic");
		});
	} catch (error) {
		logger.error("Operation delivery tick failed", {
			module: "operations",
			error,
		});
	} finally {
		running = false;
	}
}
