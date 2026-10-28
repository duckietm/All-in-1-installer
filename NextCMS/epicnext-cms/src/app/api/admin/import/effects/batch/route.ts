import { apiError } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import {
	ensureEffectDirs,
	importSingleEffect,
} from "@/lib/services/effect-import";
import { runSseBatch } from "@/lib/services/import/core/sse-batch";
import type { EffectMapEntry } from "@/types/effects";

export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const body = await request.json();
		const rawItems: EffectMapEntry[] = body.items || [];
		const concurrency = body.concurrency || 3;
		if (rawItems.length === 0) return apiError("No effects to import", 400);

		// Dedupe by lib (the .nitro filename) to avoid double work in one request.
		const seen = new Set<string>();
		const items = rawItems.filter((it) => {
			if (seen.has(it.lib)) return false;
			seen.add(it.lib);
			return true;
		});

		await ensureEffectDirs();

		return runSseBatch<EffectMapEntry>({
			items,
			concurrency,
			signal: request.signal,
			labelOf: (it) => it.lib,
			worker: async (it, _index, report) => {
				const r = await importSingleEffect({
					id: it.id,
					lib: it.lib,
					type: it.type,
					revision: it.revision,
					onProgress: report,
				});
				if (r.ok) {
					logAudit({
						userId: ctx.session.user.id,
						action: "effect_import",
						target: "EffectMap",
						targetId: 0,
						after: { id: it.id, lib: it.lib, type: it.type, batch: true },
					});
				}
				return { ok: r.ok, warnings: r.warnings, error: r.error };
			},
		});
	},
);
