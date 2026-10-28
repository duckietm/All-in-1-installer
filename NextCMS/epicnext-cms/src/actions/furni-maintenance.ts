"use server";

import { requirePermission } from "@/lib/admin/guard";
import { PERMS } from "@/lib/permissions";
import {
	type ActionResult,
	actionOk,
	handleActionError,
} from "@/lib/safe-action-shared";
import { withCatalogExport } from "@/lib/services/catalog-git-queue";
import type {
	AlignResult,
	DedupResult,
	FixEmulatorResult,
	FixOfferResult,
	FixSpriteResult,
	FurniHealth,
	ReconcileResult,
} from "@/lib/services/furni-maintenance";
import * as maintenance from "@/lib/services/furni-maintenance";

async function guard() {
	await requirePermission(PERMS.CATALOG_EDIT);
}

export async function getFurniHealthAction(): Promise<
	ActionResult<{ health: FurniHealth }>
> {
	try {
		await guard();
		const health = await maintenance.getFurniHealth();
		return actionOk({ health });
	} catch (e) {
		return handleActionError(e);
	}
}

export async function fixSpriteIdsAction(): Promise<
	ActionResult<FixSpriteResult>
> {
	try {
		await guard();
		return await withCatalogExport(async () => {
			return actionOk(await maintenance.fixSpriteIds());
		});
	} catch (e) {
		return handleActionError(e);
	}
}

export async function fixCatalogOffersAction(): Promise<
	ActionResult<FixOfferResult>
> {
	try {
		await guard();
		return await withCatalogExport(async () => {
			return actionOk(await maintenance.fixCatalogOffers());
		});
	} catch (e) {
		return handleActionError(e);
	}
}

export async function fixEmulatorIssuesAction(): Promise<
	ActionResult<FixEmulatorResult>
> {
	try {
		await guard();
		return await withCatalogExport(async () => {
			return actionOk(await maintenance.fixEmulatorIssues());
		});
	} catch (e) {
		return handleActionError(e);
	}
}

export async function reconcileIdsAction(): Promise<
	ActionResult<ReconcileResult>
> {
	try {
		await guard();
		return await withCatalogExport(async () => {
			return actionOk(await maintenance.reconcileIds());
		});
	} catch (e) {
		return handleActionError(e);
	}
}

export async function removeDuplicateItemsBaseAction(): Promise<
	ActionResult<DedupResult>
> {
	try {
		await guard();
		return await withCatalogExport(async () => {
			return actionOk(await maintenance.removeDuplicates());
		});
	} catch (e) {
		return handleActionError(e);
	}
}

export async function previewAlignIdsAction(): Promise<
	ActionResult<AlignResult>
> {
	try {
		await guard();
		return actionOk(await maintenance.forceItemsBaseIdsToFurnidata(false));
	} catch (e) {
		return handleActionError(e);
	}
}

export async function applyAlignIdsAction(): Promise<
	ActionResult<AlignResult>
> {
	try {
		await guard();
		return await withCatalogExport(async () => {
			return actionOk(await maintenance.forceItemsBaseIdsToFurnidata(true));
		});
	} catch (e) {
		return handleActionError(e);
	}
}

export async function fixEverythingAction(input?: {
	dedupePages?: boolean;
}): Promise<ActionResult<maintenance.FixAllResult>> {
	try {
		await guard();
		return await withCatalogExport(async () => {
			return actionOk(await maintenance.fixEverything(input ?? {}));
		});
	} catch (e) {
		return handleActionError(e);
	}
}
