"use server";
import { revalidatePath } from "next/cache";
import type { BulkOfferInput } from "@/features/catalog/domain/bulk-offers";
import { CatalogInputError } from "@/features/catalog/domain/hierarchy";
import {
	applyBulkOffersCommand,
	type BulkCatalogKind,
	listBulkOfferDestinationsCommand,
	previewBulkOffersCommand,
	undoBulkOffersCommand,
} from "@/features/catalog/server/bulk-offers";
import { catalogFailure } from "@/features/catalog/server/errors";
import { OperationConflict } from "@/features/operations/model";
import { requirePermission } from "@/lib/admin/guard";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";
import { withCatalogExport } from "@/lib/services/catalog-git-queue";
import { logStaffActivity } from "@/lib/services/staff-activity";

/** The catalog is a server boundary, not a client choice. */
function bulkKind(catalog: unknown): BulkCatalogKind {
	if (catalog === "bc") return "bc";
	if (catalog === "normal" || catalog === undefined) return "normal";
	throw new CatalogInputError("Invalid catalog");
}

function catalogLabel(kind: BulkCatalogKind): string {
	return kind === "bc" ? "Builder Club" : "catalog";
}

const FIELD_LABELS: Record<keyof BulkOfferInput["changes"], string> = {
	costCredits: "credits",
	costPoints: "points",
	pointsType: "points type",
	pageId: "category",
};

/**
 * The audit log has no undo of its own, so it must record *what* changed, not
 * just that something did. An entry that only says "bulk updated 200 offers"
 * cannot answer the question the log exists for.
 */
function describeChanges(changes: BulkOfferInput["changes"]): string {
	return Object.entries(changes)
		.map(([key, change]) => {
			if (change && typeof change === "object" && "mode" in change)
				return `${FIELD_LABELS[key as keyof BulkOfferInput["changes"]]} ${
					change.mode === "percent"
						? `by ${change.value}%`
						: `${change.mode} ${change.value}`
				}`;
			if (key === "pageId") return `category moved to #${String(change)}`;
			return `${FIELD_LABELS[key as keyof BulkOfferInput["changes"]]} = ${String(change)}`;
		})
		.join(", ");
}

export async function previewBulkOffers(
	input: BulkOfferInput,
	catalog: unknown = "normal",
) {
	await requirePermission(PERMS.CATALOG_VIEW);
	try {
		return {
			ok: true as const,
			data: await previewBulkOffersCommand(input, bulkKind(catalog)),
		};
	} catch (error) {
		return {
			ok: false as const,
			error:
				error instanceof OperationConflict
					? error.message
					: catalogFailure(error).message,
		};
	}
}
export async function applyBulkOffers(
	input: BulkOfferInput,
	fingerprint: string,
	requestKey?: string,
	catalog: unknown = "normal",
) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	const kind = bulkKind(catalog);
	try {
		return await withCatalogExport(async () => {
			const data = await applyBulkOffersCommand(
				input,
				fingerprint,
				staff.id,
				requestKey,
				kind,
			);
			if (data.changedCount > 0) {
				await logStaffActivity({
					staffId: staff.id,
					action: "catalog_bulk_offers",
					description: `Bulk updated ${data.changedCount} ${catalogLabel(kind)} offer(s) across ${new Set(input.ids).size} selected: ${describeChanges(input.changes)}`,
					targetType: "catalog_page",
					targetId: input.changes.pageId,
				});
				refreshCatalog();
			}
			return { ok: true as const, data };
		});
	} catch (error) {
		return {
			ok: false as const,
			error:
				error instanceof OperationConflict
					? error.message
					: catalogFailure(error).message,
		};
	}
}

export async function getBulkOfferDestinations(catalog: unknown = "normal") {
	await requirePermission(PERMS.CATALOG_VIEW);
	try {
		return {
			ok: true as const,
			data: await listBulkOfferDestinationsCommand(bulkKind(catalog)),
		};
	} catch (error) {
		return {
			ok: false as const,
			error:
				error instanceof OperationConflict
					? error.message
					: catalogFailure(error).message,
		};
	}
}

export async function undoBulkOffers(
	historyIds: number[],
	requestKey?: string,
) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	try {
		return await withCatalogExport(async () => {
			const data = await undoBulkOffersCommand(
				historyIds,
				staff.id,
				requestKey,
			);
			await logStaffActivity({
				staffId: staff.id,
				action: "catalog_bulk_undo",
				description: `Restored ${data.changedCount} catalog offer(s) from history #${historyIds.join(", ")}`,
				targetType: "catalog_offer",
			});
			refreshCatalog();
			return { ok: true as const, data };
		});
	} catch (error) {
		return {
			ok: false as const,
			error:
				error instanceof OperationConflict
					? error.message
					: catalogFailure(error).message,
		};
	}
}

function refreshCatalog() {
	try {
		revalidatePath("/admin/catalog", "layout");
		revalidatePath("/admin/logs/audit");
	} catch (error) {
		logger.error("Catalog committed; page invalidation failed", {
			module: "catalog",
			error,
		});
	}
}
