"use server";

import { z } from "zod";
import { invalidateCatalogTotals } from "@/features/catalog/server/catalog-totals";
import { db, WebsiteSetting } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { adminAction } from "@/lib/safe-action";
import { actionOk } from "@/lib/safe-action-shared";
import { withCatalogExport } from "@/lib/services/catalog-git-queue";
import { deleteImportedItem } from "@/lib/services/furni-import";
import { siteSettings } from "@/lib/services/site-settings";

const deleteSchema = z.object({ classname: z.string().trim().min(1) });

export const deleteImportedFurni = adminAction(
	{ permission: PERMS.ASSETS_IMPORT, schema: deleteSchema },
	async (ctx) => {
		const result = (await withCatalogExport(() =>
			deleteImportedItem(ctx.data.classname),
		)) as unknown as Record<string, unknown>;
		// Deleting an imported item can remove its offer and category page.
		invalidateCatalogTotals();
		return actionOk(result);
	},
);

const translateToggleSchema = z.object({ enabled: z.boolean() });

/** Persist the global "translate furniture names" setting from the studio. */
export const setFurnidataTranslateEnabled = adminAction(
	{ permission: PERMS.ASSETS_IMPORT, schema: translateToggleSchema },
	async (ctx) => {
		const value = ctx.data.enabled ? "1" : "0";
		await db
			.insert(WebsiteSetting)
			.values({ key: "furnidata_translate_enabled", value })
			.onDuplicateKeyUpdate({ set: { value } });
		await siteSettings.reload();
		return actionOk({ enabled: ctx.data.enabled });
	},
);
