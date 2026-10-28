import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { clearFurniImportCache } from "@/lib/services/furni-import-cache";
import {
	autoCleanFakeNitros,
	finishAutoClean,
} from "@/lib/services/nitro-cleanup";

/** Automatically remove fake .nitro leftovers older than `maxAgeDays`. */
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		let body: { maxAgeDays?: unknown };
		try {
			body = await request.json();
		} catch {
			return apiError("Invalid JSON body", 400);
		}
		const maxAgeDays =
			typeof body?.maxAgeDays === "number" && Number.isFinite(body.maxAgeDays)
				? Math.max(0, Math.floor(body.maxAgeDays))
				: 30;
		try {
			const result = await autoCleanFakeNitros(maxAgeDays);
			await finishAutoClean({
				result,
				maxAgeDays,
				triggeredBy: "manual",
			});
			clearFurniImportCache();
			if (result.deleted > 0) {
				logAudit({
					userId: ctx.session.user.id,
					action: "nitro_auto_cleanup",
					target: "NitroFiles",
					after: {
						maxAgeDays,
						deleted: result.deleted,
						copiesRemoved: result.copiesRemoved,
						skippedRecent: result.skippedRecent,
						skippedBroken: result.skippedBroken,
						errors: result.errors.length > 0 ? result.errors : undefined,
					},
				});
			}
			return apiOk({
				deleted: result.deleted,
				copiesRemoved: result.copiesRemoved,
				skippedRecent: result.skippedRecent,
				skippedBroken: result.skippedBroken,
				errors: result.errors.length > 0 ? result.errors : undefined,
			});
		} catch (err) {
			return apiError(
				`Nitro auto-cleanup failed: ${(err as Error).message}`,
				500,
			);
		}
	},
);
