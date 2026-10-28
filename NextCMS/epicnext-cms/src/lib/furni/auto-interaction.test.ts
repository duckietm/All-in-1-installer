import { describe, expect, it } from "vitest";
import {
	autoDetectInteraction,
	nitroAnimationStatesCount,
} from "./auto-interaction";

describe("autoDetectInteraction with real data", () => {
	it("trusts real flags over keywords for sit", () => {
		const result = autoDetectInteraction("chair_plasto", "Chair", {
			cansiton: true,
			canlayon: false,
			canstandon: false,
		});
		expect(result.canSit).toBe(true);
		expect(result.canLay).toBe(false);
		expect(result.canStand).toBe(false);
		expect(result.interactionModesCount).toBe(1);
		expect(result.reason).toContain("Real furniture data");
	});

	it("trusts real flags over keywords for lay", () => {
		const result = autoDetectInteraction("bed_silo_two", "Bed", {
			cansiton: false,
			canlayon: true,
			canstandon: false,
		});
		expect(result.canSit).toBe(false);
		expect(result.canLay).toBe(true);
		expect(result.interactionModesCount).toBe(1);
		expect(result.interactionType).toBe("bed");
	});

	it("respects curated all-false real flags (no keyword false positive)", () => {
		const result = autoDetectInteraction("table_plasto_4leg", "Table", {
			cansiton: false,
			canlayon: false,
			canstandon: false,
			hasActionData: true,
		});
		expect(result.canSit).toBe(false);
		expect(result.canLay).toBe(false);
		expect(result.canStand).toBe(false);
		expect(result.interactionModesCount).toBe(0);
	});

	it("falls back to keywords when flags carry no action data", () => {
		const result = autoDetectInteraction("chaise_metal_lamarr", "Chaise", {
			cansiton: false,
			canlayon: false,
			canstandon: false,
			animationStates: 4,
		});
		expect(result.canSit).toBe(true);
		expect(result.canStand).toBe(false);
		expect(result.interactionModesCount).toBe(4);
	});

	it("detects French bench (banquette) with raw state count", () => {
		const result = autoDetectInteraction("banquette_lamarr", "Banquette", {
			cansiton: false,
			canlayon: false,
			canstandon: false,
			animationStates: 6,
		});
		expect(result.canSit).toBe(true);
		expect(result.interactionType).toBe("bench");
		expect(result.interactionModesCount).toBe(6);
	});

	it("does not match short keywords without token boundaries", () => {
		const result = autoDetectInteraction("bedside_table", "Bedside Table", {
			cansiton: false,
			canlayon: false,
			canstandon: false,
		});
		expect(result.canSit).toBe(false);
		expect(result.canLay).toBe(false);
		expect(result.interactionType).toBe("table");
	});

	it("detects dice mechanics from classname with fixed modes=6", () => {
		const result = autoDetectInteraction("dice", "Dice", {
			cansiton: false,
			canlayon: false,
			canstandon: false,
			logicType: "furniture_multistate",
			animationStates: 7,
		});
		expect(result.interactionType).toBe("dice");
		expect(result.interactionModesCount).toBe(6);
	});

	it("detects teleport mechanics with fixed modes=2", () => {
		const result = autoDetectInteraction("teleport_door", "Teleport", {
			cansiton: false,
			canlayon: false,
			canstandon: true,
			logicType: "furniture_multistate",
			animationStates: 3,
		});
		expect(result.interactionType).toBe("teleport");
		expect(result.interactionModesCount).toBe(2);
	});

	it("uses real animation states for generic multistate items", () => {
		const result = autoDetectInteraction("sleepy_24_block_01", "", {
			cansiton: false,
			canlayon: false,
			canstandon: false,
			animationStates: 13,
		});
		expect(result.interactionModesCount).toBe(13);
	});

	it("still keyword-falls-back when no real data is present", () => {
		const result = autoDetectInteraction("chair_plasto", "Plasto Chair");
		expect(result.canSit).toBe(true);
		expect(result.interactionModesCount).toBe(1);
		expect(result.reason).toContain("chair");
	});
});

describe("nitroAnimationStatesCount", () => {
	it("counts dice-style states", () => {
		expect(
			nitroAnimationStatesCount({
				visualizations: [
					{
						animations: {
							"0": {},
							"1": {},
							"2": {},
							"3": {},
							"4": {},
							"5": {},
							"6": {},
						},
					},
				],
			}),
		).toBe(7);
	});

	it("returns undefined for basic items without animations", () => {
		expect(
			nitroAnimationStatesCount({ visualizations: [{ animations: {} }] }),
		).toBeUndefined();
	});

	it("ignores jukebox track states above 99", () => {
		expect(
			nitroAnimationStatesCount({
				visualizations: [{ animations: { "0": {}, "1": {}, "100": {} } }],
			}),
		).toBe(2);
	});

	it("returns undefined for null input", () => {
		expect(nitroAnimationStatesCount(null)).toBeUndefined();
	});
});
