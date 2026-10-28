"use server";
import { revalidatePath } from "next/cache";
import type {
	DuplicateInput,
	DuplicatePreview,
} from "@/features/catalog/domain/duplicate";
import {
	duplicateCategoryCommand,
	duplicateDestinationsCommand,
	previewDuplicateCommand,
} from "@/features/catalog/server/duplicate-commands";
import { catalogFailure } from "@/features/catalog/server/errors";
import { sendCatalogUpdate } from "@/features/catalog/server/sync-status";
import { requirePermission } from "@/lib/admin/guard";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";
import { withCatalogExport } from "@/lib/services/catalog-git-queue";
import { logStaffActivity } from "@/lib/services/staff-activity";
export async function previewCatalogDuplicate(input: DuplicateInput) {
	await requirePermission(PERMS.CATALOG_VIEW);
	try {
		return { ok: true as const, data: await previewDuplicateCommand(input) };
	} catch (error) {
		return { ok: false as const, error: catalogFailure(error).message };
	}
}
export async function applyCatalogDuplicate(input: DuplicatePreview) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	return withCatalogExport(async () => {
		let data: Awaited<ReturnType<typeof duplicateCategoryCommand>>;
		try {
			data = await duplicateCategoryCommand(input);
		} catch (error) {
			return { ok: false as const, error: catalogFailure(error).message };
		}
		const hotel = await sendCatalogUpdate();
		await logStaffActivity({
			staffId: staff.id,
			action: "catalog_page_create",
			description: `Duplicated ${input.kind} category #${input.sourceId} to #${data.id}: ${data.pages} categories, ${data.offers} offers`,
			targetType: "catalog_page",
			targetId: data.id,
		}).catch((error) => {
			logger.error("Category duplicated but audit logging failed", {
				module: "catalog",
				error,
			});
		});
		revalidatePath("/admin/catalog");
		return { ok: true as const, data: { ...data, hotel } };
	});
}

export async function catalogDuplicateDestinations(
	kind: DuplicateInput["kind"],
) {
	await requirePermission(PERMS.CATALOG_VIEW);
	try {
		return {
			ok: true as const,
			data: await duplicateDestinationsCommand(kind),
		};
	} catch (error) {
		return { ok: false as const, error: catalogFailure(error).message };
	}
}
