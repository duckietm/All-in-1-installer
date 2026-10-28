import { apiError } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { importClothingSet } from "@/lib/services/clothing-set-import";
import { runSseBatch } from "@/lib/services/import/core/sse-batch";

interface ClothingSetBatchItem {
	setType: string;
	setId: number;
}

export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const body = await request.json();
		const rawItems: ClothingSetBatchItem[] = body.items || [];
		const concurrency = body.concurrency || 3;
		if (rawItems.length === 0)
			return apiError("No clothing sets to import", 400);

		const seen = new Set<string>();
		const items = rawItems.filter((it) => {
			const key = `${it.setType}:${it.setId}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		return runSseBatch<ClothingSetBatchItem>({
			items,
			concurrency,
			signal: request.signal,
			labelOf: (it) => `${it.setType}-${it.setId}`,
			worker: async (it, _index, report) => {
				const r = await importClothingSet({
					setType: it.setType,
					setId: it.setId,
					onProgress: report,
				});
				if (r.ok) {
					logAudit({
						userId: ctx.session.user.id,
						action: "clothing_set_import",
						target: "ClothingSet",
						targetId: it.setId,
						after: { setType: it.setType, setId: it.setId, batch: true },
					});
				}
				return { ok: r.ok, warnings: r.warnings, error: r.error };
			},
		});
	},
);
