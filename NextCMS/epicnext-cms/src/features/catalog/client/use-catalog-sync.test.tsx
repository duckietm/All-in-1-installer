// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adminFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-fetch", () => ({ adminFetch }));

import {
	checkCatalogRevision,
	resetLiveCatalogForTests,
	useCatalogSync,
	useLiveCatalog,
} from "./use-live-catalog";

function page(id: number, caption = `page ${id}`) {
	return {
		id,
		caption,
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
	};
}

/** What the server currently looks like, as the route would report it. */
const server = {
	revision: "rev-1",
	pages: [page(1)],
	treeFails: false,
};

function respond(body: unknown) {
	return {
		ok: true,
		status: 200,
		json: async () => body,
		headers: new Headers(),
	} as unknown as Response;
}

function serve(): Response {
	const url = String(adminFetch.mock.calls.at(-1)?.[0] ?? "");
	if (url.includes("/catalog/revision"))
		return respond({ revision: server.revision });
	if (server.treeFails) {
		return {
			ok: false,
			status: 500,
			json: async () => ({}),
			headers: new Headers(),
		} as unknown as Response;
	}
	return respond({
		pages: server.pages,
		totals: null,
		revision: server.revision,
	});
}

function Probe() {
	// The real interval is long; each test drives the revision check itself.
	useCatalogSync(600_000);
	const { tree, refreshError } = useLiveCatalog();
	return (
		<div>
			<span data-testid="captions">
				{tree.map((node) => node.caption).join(",")}
			</span>
			{refreshError ? <span data-testid="stale">stale</span> : null}
		</div>
	);
}

let container: HTMLDivElement;
let root: Root;
const navigations: string[] = [];

async function render() {
	await act(async () => {
		root.render(<Probe />);
		await Promise.resolve();
	});
}

function captions() {
	return container.querySelector('[data-testid="captions"]')?.textContent ?? "";
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

describe("useCatalogSync", () => {
	beforeEach(async () => {
		resetLiveCatalogForTests();
		adminFetch.mockReset();
		server.revision = "rev-1";
		server.pages = [page(1)];
		server.treeFails = false;
		adminFetch.mockImplementation(serve);
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		navigations.length = 0;
		window.addEventListener("beforeunload", () => navigations.push("unload"));
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	it("updates the mounted tree when an import finishes in another session", async () => {
		await render();
		expect(captions()).toBe("page 1");

		// Another tab, browser or the job worker wrote the catalog.
		server.revision = "rev-2";
		server.pages = [page(1), page(2, "Imported Furniture")];
		await act(async () => {
			await checkCatalogRevision();
		});

		expect(captions()).toBe("page 1,Imported Furniture");
		// Nothing about this update went through the router: the document was
		// never torn down and no navigation was triggered.
		expect(navigations).toEqual([]);
		expect(document.body.contains(container)).toBe(true);
	});

	it("follows a catalog write announced by another tab", async () => {
		await render();
		const otherTab = new BroadcastChannel("atom-cms-catalog");

		server.revision = "rev-3";
		server.pages = [page(1), page(7, "Chairs")];
		otherTab.postMessage({ revision: "rev-3" });
		await flush();

		expect(captions()).toBe("page 1,Chairs");
		otherTab.close();
	});

	it("keeps the previous tree and marks it stale when the read fails", async () => {
		await render();
		server.treeFails = true;
		server.revision = "rev-4";

		await act(async () => {
			await checkCatalogRevision();
		});

		expect(captions()).toBe("page 1");
		expect(container.querySelector('[data-testid="stale"]')).not.toBeNull();
	});
});
