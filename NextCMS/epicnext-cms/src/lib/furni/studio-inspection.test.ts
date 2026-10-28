import { describe, expect, it } from "vitest";
import {
	compareFurniture,
	type FurnitureInspection,
	validateClassnames,
} from "./studio-inspection";

const source = {
	name: "Chair",
	description: "A chair",
	revision: 2,
	type: "flooritem",
};
const empty: FurnitureInspection = {
	classname: "chair",
	sql: [],
	catalog: [],
	furnidata: [],
	furnidataReadable: true,
	nitro: { exists: false, bytes: 0 },
	icon: { exists: false, bytes: 0 },
};
describe("studio inspection", () => {
	it("rejects paths and oversized batches", () => {
		expect(validateClassnames(["../file"])).toBeNull();
		expect(validateClassnames(["a\\b"])).toBeNull();
		expect(validateClassnames(Array(501).fill("chair"))).toBeNull();
		expect(validateClassnames(["chair*0", "chair*0"])).toEqual(["chair*0"]);
	});
	it("identifies new furniture only after a successful lookup", () => {
		expect(compareFurniture(source, empty).state).toBe("new");
		expect(
			compareFurniture(source, { ...empty, furnidataReadable: false }).state,
		).toBe("unknown");
	});
	it("compares values without treating allocated IDs as conflicts", () => {
		const local = {
			...empty,
			sql: [{ id: 901, spriteId: 902, name: "Old chair", type: "s" }],
			furnidata: [
				{
					id: 902,
					name: "Old chair",
					description: "Old",
					revision: 1,
					type: "flooritem",
				},
			],
		};
		expect(compareFurniture(source, local).state).toBe("changed");
		expect(
			compareFurniture(source, local).fields.find((f) => f.label === "Name")
				?.changed,
		).toBe(true);
	});
	it("flags duplicate SQL classnames as conflicts", () => {
		expect(
			compareFurniture(source, {
				...empty,
				sql: [
					{ id: 1, spriteId: 1, name: "Chair", type: "s" },
					{ id: 2, spriteId: 2, name: "Chair", type: "s" },
				],
			}).state,
		).toBe("conflict");
	});
});

import { furnitureHealth } from "./studio-inspection";

it("does not call SQL-only furniture complete", () => {
	expect(
		furnitureHealth({
			...empty,
			sql: [{ id: 1, spriteId: 2, name: "chair", type: "s" }],
		}),
	).toMatchObject({
		state: "incomplete",
		missing: ["Nitro", "Icon", "Furnidata", "Catalog offer"],
	});
});
it("keeps inaccessible assets unverified", () => {
	expect(
		furnitureHealth({ ...empty, nitro: { exists: null, bytes: 0 } }).state,
	).toBe("unknown");
});
it("detects mismatched local sprite IDs", () => {
	expect(
		furnitureHealth({
			...empty,
			sql: [{ id: 1, spriteId: 2, name: "chair", type: "s" }],
			furnidata: [
				{
					id: 3,
					name: "chair",
					description: "",
					revision: 1,
					type: "flooritem",
				},
			],
		}).state,
	).toBe("conflict");
});
