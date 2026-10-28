// @ts-nocheck
import { promises as fs } from "node:fs";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimePath } from "@/lib/utils/runtime-path";
import type { EffectMapEntry } from "@/types/effects";
import {
	__setEffectMapPathForTests,
	listLocalEffects,
	mergeEffect,
	readEffectMap,
	removeEffect,
} from "./effectmap";

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: vi.fn(async () => "") },
}));

let dir: string;
let file: string;

const ENTRY: EffectMapEntry = {
	id: "fx_1",
	lib: "fx_1",
	type: "fx",
	revision: 1,
};

beforeEach(async () => {
	dir = await fs.mkdtemp(getRuntimePath(os.tmpdir(), "effectmap-"));
	file = getRuntimePath(dir, "EffectMap.json");
	await fs.writeFile(file, JSON.stringify({ effects: [ENTRY] }));
	__setEffectMapPathForTests(file);
});

afterEach(async () => {
	__setEffectMapPathForTests(null);
	await fs.rm(dir, { recursive: true, force: true });
});

describe("lib/services/effectmap", () => {
	it("lists local effects from the map", async () => {
		const effects = await listLocalEffects();
		expect(effects).toEqual([ENTRY]);
	});

	it("returns an empty list when the file has no effects array", async () => {
		await fs.writeFile(file, JSON.stringify({}));
		expect(await readEffectMap()).toEqual({ effects: [] });
	});

	it("adds a new effect via mergeEffect", async () => {
		const added: EffectMapEntry = {
			id: "fx_2",
			lib: "fx_2",
			type: "fx",
			revision: 2,
		};
		await mergeEffect(added);
		const effects = await listLocalEffects();
		expect(effects).toHaveLength(2);
		expect(effects).toContainEqual(added);
	});

	it("updates an existing effect in place via mergeEffect", async () => {
		await mergeEffect({ ...ENTRY, revision: 5 });
		const effects = await listLocalEffects();
		expect(effects).toHaveLength(1);
		expect(effects[0].revision).toBe(5);
	});

	it("removes an effect by id", async () => {
		expect(await removeEffect("fx_1")).toBe(true);
		expect(await listLocalEffects()).toEqual([]);
	});

	it("removes an effect by lib name", async () => {
		expect(await removeEffect("fx_1")).toBe(true);
		expect(await listLocalEffects()).toEqual([]);
	});

	it("reports false when nothing was removed", async () => {
		expect(await removeEffect("missing")).toBe(false);
		expect(await listLocalEffects()).toHaveLength(1);
	});
});
