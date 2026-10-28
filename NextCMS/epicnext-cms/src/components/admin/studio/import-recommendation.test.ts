import { describe, expect, it } from "vitest";
import type { FurnitureInspection } from "@/lib/furni/studio-inspection";
import { importRecommendation } from "./import-recommendation";

const local: FurnitureInspection = {
	classname: "chair",
	sql: [{ id: 1, spriteId: 1, name: "Chair", type: "s" }],
	catalog: [],
	furnidata: [],
	furnidataReadable: true,
	icon: { exists: false, bytes: 0 },
	nitro: { exists: true, bytes: 42 },
};
describe("import recommendations", () => {
	it("proposes completion with the precise missing components for existing SQL", () => {
		expect(importRecommendation(local)).toEqual({
			action: "complete",
			missing: ["catalog", "furnidata", "icon"],
			unknown: [],
		});
	});
	it("keeps unavailable checks distinct from missing parts", () => {
		expect(
			importRecommendation({
				...local,
				furnidataReadable: false,
				icon: { exists: null, bytes: 0 },
			}),
		).toEqual({
			action: "verify",
			missing: ["catalog"],
			unknown: ["furnidata", "icon"],
		});
	});
	it("prioritizes conflicts over completing missing parts", () => {
		expect(
			importRecommendation({ ...local, sql: [...local.sql, ...local.sql] })
				.action,
		).toBe("conflict");
	});
	it("proposes import when no local components exist", () => {
		expect(
			importRecommendation({
				...local,
				sql: [],
				nitro: { exists: false, bytes: 0 },
			}).action,
		).toBe("import");
	});
	it("recognizes partial furniture even without a SQL row", () => {
		expect(importRecommendation({ ...local, sql: [] }).action).toBe("complete");
	});
});
