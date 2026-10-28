import { apiError } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { runSseBatch } from "@/lib/services/import/core/sse-batch";
import { ensurePetDirs, importSinglePet } from "@/lib/services/pet-import";

interface PetBatchItem {
	lib: string;
}

export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const body = await request.json();
		const rawItems: PetBatchItem[] = body.items || [];
		const concurrency = body.concurrency || 3;
		if (rawItems.length === 0) return apiError("No pets to import", 400);

		const seen = new Set<string>();
		const items = rawItems.filter((it) => {
			if (seen.has(it.lib)) return false;
			seen.add(it.lib);
			return true;
		});

		await ensurePetDirs();

		return runSseBatch<PetBatchItem>({
			items,
			concurrency,
			signal: request.signal,
			labelOf: (it) => it.lib,
			worker: async (it, _index, report) => {
				const r = await importSinglePet({ lib: it.lib, onProgress: report });
				if (r.ok) {
					logAudit({
						userId: ctx.session.user.id,
						action: "pet_import",
						target: "PetAsset",
						targetId: 0,
						after: { lib: it.lib, batch: true },
					});
				}
				return { ok: r.ok, warnings: r.warnings, error: r.error };
			},
		});
	},
);
