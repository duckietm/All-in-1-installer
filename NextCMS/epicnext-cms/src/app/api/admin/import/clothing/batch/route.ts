import { apiError } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import {
	ensureFigureDirs,
	importSingleFigure,
} from "@/lib/services/figure-import";
import { runSseBatch } from "@/lib/services/import/core/sse-batch";

interface FigureBatchItem {
	lib: string;
}

export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const body = await request.json();
		const rawItems: FigureBatchItem[] = body.items || [];
		const concurrency = body.concurrency || 3;
		if (rawItems.length === 0) return apiError("No libraries to import", 400);

		const seen = new Set<string>();
		const items = rawItems.filter((it) => {
			if (seen.has(it.lib)) return false;
			seen.add(it.lib);
			return true;
		});

		await ensureFigureDirs();

		return runSseBatch<FigureBatchItem>({
			items,
			concurrency,
			signal: request.signal,
			labelOf: (it) => it.lib,
			worker: async (it, _index, report) => {
				const r = await importSingleFigure({ lib: it.lib, onProgress: report });
				if (r.ok) {
					logAudit({
						userId: ctx.session.user.id,
						action: "figure_import",
						target: "FigureAsset",
						targetId: 0,
						after: { lib: it.lib, batch: true },
					});
				}
				return { ok: r.ok, warnings: r.warnings, error: r.error };
			},
		});
	},
);
