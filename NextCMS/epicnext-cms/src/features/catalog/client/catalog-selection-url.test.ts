import { describe, expect, it } from "vitest";
import {
	readCatalogSelection,
	writeCatalogSelection,
} from "./catalog-selection-url";

describe("catalog selection URL", () => {
	it("restores category context without disturbing catalog, search or pagination", () => {
		const url = new URL(
			"https://cms.test/admin/catalog?catalog=bc&search=chair&page=4",
		);
		const selected = writeCatalogSelection(url, { rootId: 8, pageId: 12 });
		expect(readCatalogSelection(selected)).toEqual({ rootId: 8, pageId: 12 });
		expect(selected.searchParams.get("catalog")).toBe("bc");
		expect(selected.searchParams.get("search")).toBe("chair");
		expect(selected.searchParams.get("page")).toBe("4");
		expect(url.searchParams.has("category")).toBe(false);
		expect(
			writeCatalogSelection(selected, {
				rootId: 8,
				pageId: null,
			}).searchParams.has("category"),
		).toBe(false);
	});
	it.each(["-1", "0", "1.5", "1abc", "Infinity", "9007199254740992"])(
		"rejects invalid identifiers: %s",
		(id) => {
			expect(
				readCatalogSelection(
					new URL(`https://cms.test/?root=${id}&category=${id}`),
				),
			).toEqual({ rootId: null, pageId: null });
		},
	);
});
