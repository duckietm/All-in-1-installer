import { NextResponse } from "next/server";
import { readCatalogRevision } from "@/features/catalog/server/catalog-revision";
import { loadCatalogTotals } from "@/features/catalog/server/catalog-totals";
import { catalogFailure } from "@/features/catalog/server/errors";
import {
	deletePageCommand,
	togglePageCommand,
} from "@/features/catalog/server/page-commands";
import { sendCatalogUpdate } from "@/features/catalog/server/sync-status";
import {
	type CatalogKind,
	readAncestors,
	readChildren,
	readFullTree,
	readPage,
	searchPages,
} from "@/features/catalog/server/tree-nodes";
import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";

export const GET = withAdmin(
	{ permission: PERMS.CATALOG_VIEW },
	async (request) => {
		const sp = request.nextUrl.searchParams;
		const kind: CatalogKind = sp.get("catalog") === "bc" ? "bc" : "normal";

		if (sp.get("mode") === "full") {
			// Totals travel with the tree so one refresh updates both the rail and
			// the stats bar. Read uncached — this response is already the fresh read.
			const [pages, totals, revision] = await Promise.all([
				readFullTree(kind),
				loadCatalogTotals(kind),
				readCatalogRevision(),
			]);
			// `revision` doubles as the ETag: a client that saw this exact catalog
			// state re-asks with `If-None-Match` and gets a 304 instead of the
			// whole flat tree, which is the only part of this payload that grows
			// with the size of the catalog.
			const etag = revision ? `"${revision}"` : null;
			if (etag && request.headers.get("if-none-match") === etag) {
				return new NextResponse(null, { status: 304, headers: { etag } });
			}
			return apiOk(
				{ pages, totals, revision },
				etag ? { headers: { etag } } : undefined,
			);
		}

		const pageIdRaw = sp.get("pageId");
		if (pageIdRaw) {
			const id = Number(pageIdRaw);
			if (!Number.isFinite(id) || id <= 0) return apiError("Invalid pageId");
			const page = await readPage(kind, id);
			if (!page) return apiError("Page not found", 404);
			return apiOk({ page });
		}

		const ancestorsRaw = sp.get("ancestors");
		if (ancestorsRaw) {
			const id = Number(ancestorsRaw);
			if (!Number.isFinite(id) || id <= 0) return apiError("Invalid id");
			const chain = await readAncestors(kind, id);
			return apiOk({ ancestors: chain.filter((a) => a.id !== id) });
		}

		const search = sp.get("search");
		if (search?.trim()) {
			return apiOk({ pages: await searchPages(kind, search.trim()) });
		}

		const parentIdRaw = sp.get("parentId");
		if (parentIdRaw !== null) {
			const parentId = Number(parentIdRaw);
			if (!Number.isFinite(parentId)) return apiError("Invalid parentId");
			return apiOk({ pages: await readChildren(kind, parentId) });
		}

		return apiOk({ pages: [] });
	},
);

export const PATCH = withAdmin(
	{ permission: PERMS.CATALOG_EDIT },
	async (request) => {
		const body = (await request.json()) as {
			pageId?: number;
			toggleField?: "toggleEnabled" | "toggleVisible";
			catalog?: string;
		};
		const pageId = Number(body.pageId);
		const field = body.toggleField === "toggleVisible" ? "visible" : "enabled";
		if (!Number.isFinite(pageId) || pageId <= 0) {
			return apiError("Invalid pageId");
		}
		const kind: CatalogKind = body.catalog === "bc" ? "bc" : "normal";
		try {
			await togglePageCommand(kind, pageId, field);
		} catch (error) {
			const failure = catalogFailure(error);
			return apiError(failure.message, failure.status);
		}
		await sendCatalogUpdate();
		return apiOk({});
	},
);

export const DELETE = withAdmin(
	{ permission: PERMS.CATALOG_EDIT },
	async (request) => {
		const sp = request.nextUrl.searchParams;
		const pageId = Number(sp.get("pageId"));
		const mode = sp.get("mode") === "cascade" ? "cascade" : "reparent";
		const kind: CatalogKind = sp.get("catalog") === "bc" ? "bc" : "normal";
		if (!Number.isFinite(pageId) || pageId <= 0) {
			return apiError("Invalid pageId");
		}
		try {
			await deletePageCommand(kind, pageId, mode);
		} catch (error) {
			const failure = catalogFailure(error);
			return apiError(failure.message, failure.status);
		}
		await sendCatalogUpdate();
		return apiOk({});
	},
);
