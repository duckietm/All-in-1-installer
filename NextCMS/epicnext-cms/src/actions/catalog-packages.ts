"use server";
import { revalidatePath } from "next/cache";
import type {
	CreateCatalogPackageInput,
	PackagePublication,
	PublishCatalogPackageInput,
	SaveCatalogPackageInput,
} from "@/features/catalog/domain/packages";
import { catalogFailure } from "@/features/catalog/server/errors";
import { packageMessage } from "@/features/catalog/server/package-messages";
import {
	createCatalogPackageCommand,
	getCatalogPackageCommand,
	listCatalogPackagesCommand,
	previewCatalogPackageCommand,
	publishCatalogPackageCommand,
	saveCatalogPackageCommand,
} from "@/features/catalog/server/packages";
import { sendCatalogUpdate } from "@/features/catalog/server/sync-status";
import { requirePermission } from "@/lib/admin/guard";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { withCatalogExport } from "@/lib/services/catalog-git-queue";

async function attempt<T>(operation: () => Promise<T>) {
	try {
		return { ok: true as const, data: await operation() };
	} catch (error) {
		return {
			ok: false as const,
			error: await packageMessage(catalogFailure(error).message),
		};
	}
}
export async function listCatalogPackages() {
	await requirePermission(PERMS.CATALOG_VIEW);
	return attempt(listCatalogPackagesCommand);
}
export async function getCatalogPackage(id: string) {
	await requirePermission(PERMS.CATALOG_VIEW);
	return attempt(() => getCatalogPackageCommand(id));
}
export async function createCatalogPackage(input: CreateCatalogPackageInput) {
	await requirePermission(PERMS.CATALOG_EDIT);
	return attempt(() => createCatalogPackageCommand(input));
}
export async function saveCatalogPackage(input: SaveCatalogPackageInput) {
	await requirePermission(PERMS.CATALOG_EDIT);
	return attempt(() => saveCatalogPackageCommand(input));
}
export async function previewCatalogPackage(id: string) {
	await requirePermission(PERMS.CATALOG_VIEW);
	return attempt(async () => {
		const data = await previewCatalogPackageCommand(id);
		return {
			...data,
			conflicts: await Promise.all(data.conflicts.map(packageMessage)),
		};
	});
}
export async function publishCatalogPackage(input: PublishCatalogPackageInput) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	return attempt(async () => {
		let committed: PackagePublication | undefined;
		const warnings: string[] = [];
		try {
			await withCatalogExport(async () => {
				committed = await publishCatalogPackageCommand(input, staff.id);
				return committed;
			});
		} catch (error) {
			if (!committed) throw error;
			warnings.push("Package published, but export scheduling failed.");
		}
		if (!committed) throw Error("Package publication did not return a result");
		const result = committed;
		if (result.alreadyPublished)
			return {
				...result,
				...(warnings.length
					? { warnings: await Promise.all(warnings.map(packageMessage)) }
					: {}),
			};
		try {
			await logAudit({
				userId: staff.id,
				action: "catalog_package_publish",
				target: "catalog_package",
				after: {
					packageId: input.id,
					pageIds: result.pageIds,
					offerCount: result.offerCount,
				},
			});
		} catch {
			warnings.push("Package published, but audit logging failed.");
		}
		try {
			const hotel = await sendCatalogUpdate();
			if (!hotel.sent)
				warnings.push(
					"Package published, but the hotel update was not delivered.",
				);
		} catch {
			warnings.push(
				"Package published, but the hotel update was not delivered.",
			);
		}
		try {
			revalidatePath("/admin/catalog");
		} catch {
			warnings.push(
				"Package published. Refresh the page to see the latest catalog.",
			);
		}
		return {
			...result,
			...(warnings.length
				? { warnings: await Promise.all(warnings.map(packageMessage)) }
				: {}),
		} satisfies PackagePublication;
	});
}
