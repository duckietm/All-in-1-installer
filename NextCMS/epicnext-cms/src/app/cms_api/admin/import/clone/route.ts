import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { assertSafeImportUrl } from "@/lib/import-url-safety";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import {
	getClonableClassnames,
	getCloneList,
	getCloneStats,
} from "@/lib/services/clone-import";
import {
	deleteSource,
	getSource,
	listSources,
	upsertSource,
} from "@/lib/services/clone-sources";

// GET ?action=sources               → list presets
// GET ?source=<id>&search=&page=&perPage=  → { items, meta, stats }
export const GET = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const sp = request.nextUrl.searchParams;

		if (sp.get("action") === "sources") {
			return apiOk({ sources: await listSources() });
		}

		const sourceId = sp.get("source");
		if (!sourceId) return apiError("Missing source or action", 400);

		const source = await getSource(sourceId);
		if (!source) return apiError("Source not found", 404);

		// GET ?source=<id>&action=clonable → all not-yet-present classnames (for "clone all")
		if (sp.get("action") === "clonable") {
			try {
				return apiOk({ classnames: await getClonableClassnames(source) });
			} catch (err) {
				return apiError(
					`Failed to fetch source data: ${(err as Error).message}`,
					502,
				);
			}
		}

		const search = sp.get("search") || "";
		const page = Math.max(Number.parseInt(sp.get("page") || "1", 10) || 1, 1);
		const perPage = Math.min(
			Math.max(Number.parseInt(sp.get("perPage") || "50", 10) || 50, 1),
			200,
		);
		const filterParam = sp.get("filter");
		const filter =
			filterParam === "missing" || filterParam === "present"
				? filterParam
				: "all";

		try {
			const [listResult, stats] = await Promise.all([
				getCloneList({ source, search, page, perPage, filter }),
				getCloneStats(source),
			]);

			return apiOk({ items: listResult.items, meta: listResult.meta, stats });
		} catch (err) {
			return apiError(
				`Failed to fetch source data: ${(err as Error).message}`,
				502,
			);
		}
	},
);

// POST — upsert a source preset
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const body = await request.json();
		const {
			name,
			furnidataUrl,
			nitroBaseUrl,
			iconBaseUrl,
			hotel,
			id,
			sourceSwfBaseUrl,
		} = body as Record<string, string>;
		const enabledRaw = (body as Record<string, unknown>).enabled;

		if (!name?.trim()) return apiError("name is required", 400);
		if (!furnidataUrl?.trim()) return apiError("furnidataUrl is required", 400);

		const normalized = (u: string | undefined) =>
			(u ?? "").trim().replace(/\/+$/, "");

		for (const [label, rawUrl] of [
			["furnidataUrl", furnidataUrl],
			["nitroBaseUrl", nitroBaseUrl],
			["iconBaseUrl", iconBaseUrl],
			["sourceSwfBaseUrl", sourceSwfBaseUrl],
		] as const) {
			if (!rawUrl?.trim()) continue;
			try {
				await assertSafeImportUrl(rawUrl, label);
			} catch (err) {
				return apiError((err as Error).message, 400);
			}
		}

		const entry = await upsertSource({
			id,
			name,
			furnidataUrl,
			nitroBaseUrl: normalized(nitroBaseUrl),
			iconBaseUrl: normalized(iconBaseUrl),
			hotel: hotel ?? "",
			sourceSwfBaseUrl: normalized(sourceSwfBaseUrl),
			enabled: enabledRaw !== "false" && enabledRaw !== false,
		});

		logAudit({
			userId: ctx.session.user.id,
			action: id ? "clone_source_update" : "clone_source_create",
			target: "CloneSource",
			targetId: 0,
			after: { id: entry.id, name: entry.name },
		});

		return apiOk({ source: entry });
	},
);

// DELETE ?id=<id>
export const DELETE = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const id = request.nextUrl.searchParams.get("id");
		if (!id) return apiError("Missing id", 400);

		const source = await getSource(id);
		if (!source) return apiError("Source not found", 404);

		await deleteSource(id);

		logAudit({
			userId: ctx.session.user.id,
			action: "clone_source_delete",
			target: "CloneSource",
			targetId: 0,
			after: { id, name: source.name },
		});

		return apiOk({ id });
	},
);
