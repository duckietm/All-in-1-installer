"use server";

import { revalidatePath } from "next/cache";
import { requirePermissionRateLimited } from "@/lib/admin/guard";
import { PERMS } from "@/lib/permissions";
import {
	actionError,
	actionOk,
	handleActionError,
} from "@/lib/safe-action-shared";
import { inspectLiveCatalogIntegrity } from "@/lib/services/catalog-audit";
import { withCatalogExport } from "@/lib/services/catalog-git-queue";
import { integrityCatalog } from "@/lib/services/catalog-integrity";
import {
	applyCatalogParentRepair,
	previewCatalogParentRepair,
} from "@/lib/services/catalog-repair";

export async function inspectCatalogIntegrityAction(catalog: unknown) {
	try {
		await requirePermissionRateLimited(PERMS.CATALOG_VIEW);
		return actionOk(
			await inspectLiveCatalogIntegrity(integrityCatalog(catalog)),
		);
	} catch (error) {
		return handleActionError(error);
	}
}

export async function previewCatalogIntegrityRepairAction(catalog: unknown) {
	try {
		await requirePermissionRateLimited(PERMS.CATALOG_EDIT);
		return actionOk(
			await previewCatalogParentRepair(integrityCatalog(catalog)),
		);
	} catch (error) {
		return handleActionError(error);
	}
}

export async function applyCatalogIntegrityRepairAction(
	catalog: unknown,
	fingerprint: unknown,
) {
	try {
		const staff = await requirePermissionRateLimited(PERMS.CATALOG_EDIT);
		const kind = integrityCatalog(catalog);
		if (typeof fingerprint !== "string") return actionError("Invalid preview");
		const result = await withCatalogExport(() =>
			applyCatalogParentRepair(kind, fingerprint, staff.id),
		);
		revalidatePath("/admin/catalog");
		revalidatePath("/admin/catalog/builder-club");
		return actionOk(result);
	} catch (error) {
		if (error instanceof Error && error.name === "CatalogPreviewConflict")
			return { ok: false as const, error: "stalePreview" as const };
		return handleActionError(error);
	}
}
