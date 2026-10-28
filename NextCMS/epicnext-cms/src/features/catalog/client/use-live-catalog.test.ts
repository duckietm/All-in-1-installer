import { beforeEach, describe, expect, it, vi } from "vitest";

const adminFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-fetch", () => ({ adminFetch }));

import {
	applyCatalogDelta,
	checkCatalogRevision,
	ensureCatalogTreeLoaded,
	getLiveCatalogSnapshot,
	refreshCatalogTree,
	resetLiveCatalogForTests,
	seedCatalogTotals,
} from "./use-live-catalog";

function ok(body: unknown, init: { etag?: string } = {}) {
	return {
		ok: true,
		status: 200,
		json: async () => body,
		headers: new Headers(init.etag ? { etag: init.etag } : {}),
	} as unknown as Response;
}

function page(id: number, over: Record<string, unknown> = {}) {
	return {
		id,
		caption: `page ${id}`,
		parentId: -1,
		depth: 0,
		orderNum: 0,
		enabled: "1",
		visible: "1",
		iconImage: 0,
		iconColor: 0,
		pageLayout: "default_3x3",
		childCount: 0,
		itemCount: 0,
		...over,
	};
}

describe("refreshCatalogTree", () => {
	beforeEach(() => {
		resetLiveCatalogForTests();
		adminFetch.mockReset();
	});

	it("adopts the tree and the totals the route reports", async () => {
		seedCatalogTotals("normal", {
			totalPages: 1,
			enabledPages: 1,
			totalItems: 1,
		});
		adminFetch.mockResolvedValue(
			ok({
				pages: [page(1), page(2, { parentId: 1, itemCount: 7 })],
				totals: { totalPages: 2, enabledPages: 2, totalItems: 7 },
			}),
		);

		await refreshCatalogTree();

		const snapshot = getLiveCatalogSnapshot();
		expect(snapshot.tree.map((n) => n.id)).toEqual([1, 2]);
		expect(snapshot.totals.normal).toEqual({
			totalPages: 2,
			enabledPages: 2,
			totalItems: 7,
		});
		expect(snapshot.treeLoaded).toBe(true);
	});

	it("replaces the counts an import delta had folded in", async () => {
		seedCatalogTotals("normal", {
			totalPages: 10,
			enabledPages: 10,
			totalItems: 100,
		});
		applyCatalogDelta({
			pages: [
				{
					id: 99,
					caption: "Chairs",
					parentId: -1,
					pageLayout: "default_3x3",
					iconImage: 0,
					iconColor: 0,
					orderNum: 0,
					enabled: "1",
					visible: "1",
				},
			],
			addedItems: [{ pageId: 99, count: 4 }],
			movedItems: [],
		});
		adminFetch.mockResolvedValue(
			ok({
				pages: [page(99)],
				totals: { totalPages: 11, enabledPages: 11, totalItems: 104 },
			}),
		);

		await refreshCatalogTree();

		expect(getLiveCatalogSnapshot().totals.normal).toEqual({
			totalPages: 11,
			enabledPages: 11,
			totalItems: 104,
		});
	});

	it("keeps the counts it holds when the route omits totals", async () => {
		seedCatalogTotals("normal", {
			totalPages: 3,
			enabledPages: 2,
			totalItems: 30,
		});
		adminFetch.mockResolvedValue(ok({ pages: [page(1)] }));

		await refreshCatalogTree();

		expect(getLiveCatalogSnapshot().totals.normal).toEqual({
			totalPages: 3,
			enabledPages: 2,
			totalItems: 30,
		});
	});

	it("collapses concurrent callers into one read plus at most one follow-up", async () => {
		adminFetch.mockResolvedValue(ok({ pages: [] }));
		await Promise.all([
			refreshCatalogTree(),
			refreshCatalogTree(),
			refreshCatalogTree(),
		]);
		expect(adminFetch.mock.calls.length).toBeLessThanOrEqual(2);
	});

	it("re-reads once for writes that land while a read is in flight", async () => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		adminFetch
			.mockImplementationOnce(async () => {
				await gate;
				return ok({ pages: [page(1)] });
			})
			.mockResolvedValueOnce(ok({ pages: [page(1), page(2)] }));

		const first = refreshCatalogTree();
		// A mutation lands while the first read is still open: its snapshot may
		// predate the write, so this caller asks for a follow-up read.
		const second = refreshCatalogTree();
		release?.();
		await Promise.all([first, second]);

		expect(adminFetch).toHaveBeenCalledTimes(2);
		expect(getLiveCatalogSnapshot().tree.map((n) => n.id)).toEqual([1, 2]);
	});

	it("keeps the tree it holds when the read fails, and says so", async () => {
		adminFetch.mockResolvedValueOnce(ok({ pages: [page(1)] }));
		await refreshCatalogTree();
		adminFetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			json: async () => ({}),
		} as unknown as Response);

		await refreshCatalogTree();

		const snapshot = getLiveCatalogSnapshot();
		expect(snapshot.tree.map((n) => n.id)).toEqual([1]);
		// A rail that cannot refresh must say so: showing the previous tree as if
		// it were current is the silent-staleness bug this error exists for.
		expect(snapshot.refreshError).toContain("500");
		expect(snapshot.refreshing).toBe(false);
	});

	it("clears the error once a later read succeeds", async () => {
		adminFetch.mockResolvedValueOnce({
			ok: false,
			status: 503,
			json: async () => ({}),
		} as unknown as Response);
		await refreshCatalogTree();
		expect(getLiveCatalogSnapshot().refreshError).toContain("503");

		adminFetch.mockResolvedValueOnce(ok({ pages: [page(1)] }));
		await refreshCatalogTree();

		expect(getLiveCatalogSnapshot().refreshError).toBeNull();
	});

	it("reports a read in flight while it runs", async () => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		adminFetch.mockImplementationOnce(async () => {
			expect(getLiveCatalogSnapshot().refreshing).toBe(true);
			await gate;
			return ok({ pages: [] });
		});

		const read = refreshCatalogTree();
		release?.();
		await read;

		expect(getLiveCatalogSnapshot().refreshing).toBe(false);
	});
});

describe("catalog revision", () => {
	beforeEach(() => {
		resetLiveCatalogForTests();
		adminFetch.mockReset();
	});

	it("adopts the revision the tree route reports", async () => {
		adminFetch.mockResolvedValueOnce(
			ok({ pages: [page(1)], revision: "rev-1" }, { etag: '"rev-1"' }),
		);

		await refreshCatalogTree();

		expect(getLiveCatalogSnapshot().revision).toBe("rev-1");
	});

	it("does not re-read the tree when the revision is unchanged", async () => {
		adminFetch.mockResolvedValueOnce(
			ok({ pages: [page(1)], revision: "rev-1" }, { etag: '"rev-1"' }),
		);
		await refreshCatalogTree();
		adminFetch.mockResolvedValueOnce(ok({ revision: "rev-1" }));

		await checkCatalogRevision();

		expect(adminFetch).toHaveBeenCalledTimes(2);
		expect(adminFetch.mock.calls[1][0]).toContain("/catalog/revision");
	});

	it("re-reads the tree when another session moved the revision on", async () => {
		adminFetch.mockResolvedValueOnce(
			ok({ pages: [page(1)], revision: "rev-1" }, { etag: '"rev-1"' }),
		);
		await refreshCatalogTree();

		adminFetch.mockResolvedValueOnce(ok({ revision: "rev-2" }));
		adminFetch.mockResolvedValueOnce(
			ok({ pages: [page(1), page(2)], revision: "rev-2" }, { etag: '"rev-2"' }),
		);

		await checkCatalogRevision();

		expect(getLiveCatalogSnapshot().tree.map((n) => n.id)).toEqual([1, 2]);
		expect(getLiveCatalogSnapshot().revision).toBe("rev-2");
	});

	it("probes the revision on every mount instead of trusting the session", async () => {
		adminFetch.mockResolvedValueOnce(
			ok({ pages: [page(1)], revision: "rev-1" }, { etag: '"rev-1"' }),
		);
		await refreshCatalogTree();

		// A second mount of the tree in the same session used to be a no-op, which
		// is why a session that started before an import kept showing the old
		// catalog.
		adminFetch.mockResolvedValueOnce(ok({ revision: "rev-1" }));
		adminFetch.mockResolvedValueOnce(ok({ revision: "rev-2" }));
		adminFetch.mockResolvedValueOnce(
			ok({ pages: [page(1), page(9)], revision: "rev-2" }, { etag: '"rev-2"' }),
		);
		await ensureCatalogTreeLoaded();
		await ensureCatalogTreeLoaded();

		expect(getLiveCatalogSnapshot().tree.map((n) => n.id)).toEqual([1, 9]);
	});

	it("replays the ETag so an unchanged catalog answers 304", async () => {
		adminFetch.mockResolvedValueOnce(
			ok({ pages: [page(1)], revision: "rev-1" }, { etag: '"rev-1"' }),
		);
		await refreshCatalogTree();

		adminFetch.mockResolvedValueOnce({
			ok: false,
			status: 304,
			json: async () => ({}),
			headers: new Headers({ etag: '"rev-1"' }),
		} as unknown as Response);
		adminFetch.mockResolvedValueOnce(ok({ revision: "rev-2" }));
		adminFetch.mockResolvedValueOnce(
			ok({ pages: [page(1), page(2)], revision: "rev-2" }, { etag: '"rev-2"' }),
		);

		await refreshCatalogTree();
		// 304 means nothing changed: the tree stays, and no error is invented.
		expect(getLiveCatalogSnapshot().tree.map((n) => n.id)).toEqual([1]);
		expect(getLiveCatalogSnapshot().refreshError).toBeNull();

		await checkCatalogRevision();

		expect(getLiveCatalogSnapshot().tree.map((n) => n.id)).toEqual([1, 2]);
		expect(adminFetch.mock.calls[1][1]).toMatchObject({
			headers: { "if-none-match": '"rev-1"' },
		});
	});

	it("stays quiet when the probe itself fails", async () => {
		adminFetch.mockResolvedValueOnce(
			ok({ pages: [page(1)], revision: "rev-1" }, { etag: '"rev-1"' }),
		);
		await refreshCatalogTree();
		adminFetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			json: async () => ({}),
		} as unknown as Response);

		await checkCatalogRevision();

		// The tree may be perfectly current; a failed probe is not a failed read.
		expect(getLiveCatalogSnapshot().refreshError).toBeNull();
		expect(getLiveCatalogSnapshot().revision).toBe("rev-1");
	});
});
