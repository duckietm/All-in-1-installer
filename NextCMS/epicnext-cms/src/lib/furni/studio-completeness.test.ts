import { describe, expect, it } from "vitest";
import { furnitureCompleteness } from "./studio-completeness";
import {
	compareFurniture,
	type FurnitureInspection,
} from "./studio-inspection";

const complete: FurnitureInspection = {
	classname: "chair",
	sql: [{ id: 100, spriteId: 200, type: "s", name: "Chair" }],
	catalog: [{ id: 50, pageId: 1, credits: 3, points: 0 }],
	furnidata: [
		{ id: 200, type: "flooritem", name: "Chair", description: "", revision: 1 },
	],
	furnidataReadable: true,
	nitro: { exists: true, bytes: 200 },
	icon: { exists: true, bytes: 30 },
};
describe("furniture completeness", () => {
	it("checks all five independent parts and accepts locally remapped IDs", () => {
		expect(furnitureCompleteness(complete).map((p) => p.status)).toEqual(
			Array(5).fill("present"),
		);
	});
	it("does not infer a catalog offer or icon from SQL and Nitro", () => {
		const parts = furnitureCompleteness({
			...complete,
			catalog: [],
			icon: { exists: false, bytes: 0 },
		});
		expect(parts.find((p) => p.id === "catalog")).toMatchObject({
			status: "missing",
			action: "catalog",
		});
		expect(parts.find((p) => p.id === "icon")).toMatchObject({
			status: "missing",
			action: "icon",
		});
		expect(parts.find((p) => p.id === "sql")?.status).toBe("present");
	});
	it("keeps unreadable assets unknown and directs operators to recheck", () => {
		const parts = furnitureCompleteness({
			...complete,
			furnidataReadable: false,
			icon: { exists: null, bytes: 0 },
		});
		expect(parts.find((p) => p.id === "furnidata")).toMatchObject({
			status: "unknown",
			action: "recheck",
		});
		expect(parts.find((p) => p.id === "icon")).toMatchObject({
			status: "unknown",
			action: "recheck",
		});
	});
	it.each([
		{ id: 201, type: "flooritem" },
		{ id: 200, type: "wallitem" },
	])(
		"flags ID or type mismatches in both review and completeness: %j",
		(change) => {
			const local = {
				...complete,
				furnidata: [{ ...complete.furnidata[0], ...change }],
			};
			expect(
				furnitureCompleteness(local)
					.filter((p) => p.status === "conflict")
					.map((p) => p.id),
			).toEqual(["sql", "furnidata"]);
			expect(
				compareFurniture(
					{ name: "Chair", description: "", revision: 1, type: "flooritem" },
					local,
				).state,
			).toBe("conflict");
		},
	);
	it("allows multiple legitimate catalog offers but surfaces duplicate SQL records", () => {
		expect(
			furnitureCompleteness({
				...complete,
				catalog: [...complete.catalog, { ...complete.catalog[0], id: 51 }],
			}).find((p) => p.id === "catalog")?.status,
		).toBe("present");
		expect(
			furnitureCompleteness({
				...complete,
				sql: [...complete.sql, { ...complete.sql[0], id: 101 }],
			}).find((p) => p.id === "sql"),
		).toMatchObject({ status: "conflict", action: "audit" });
	});
});
