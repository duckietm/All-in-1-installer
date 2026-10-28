// @ts-nocheck
import { describe, expect, it } from "vitest";
import { importClothingSet } from "@/lib/services/clothing-set-import";
import { __clearFigureOfficialCache } from "@/lib/services/figure-official";

describe("real import", {
	skip: process.env.RUN_IMPORT_REAL_LIVE !== "1",
}, () => {
	it("imports set 5044 (needs new lib shirt_M_drsports)", async () => {
		__clearFigureOfficialCache();
		const progress: string[] = [];
		const r = await importClothingSet({
			setType: "ch",
			setId: 5044,
			onProgress: (s) => progress.push(s),
		});
		expect(r.ok, JSON.stringify(r)).toBe(true);
		expect(progress).toContain("importing library shirt_M_drsports");
	}, 120000);
});
