import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createReleaseManifest, validateReleaseManifest } from "./manifest";

const digest = (value: string) => ({
	bytes: Buffer.byteLength(value),
	sha256: createHash("sha256").update(value).digest("hex"),
});
const entry = (path: string, value = "bytes") => ({ path, ...digest(value) });

describe("catalog release manifest", () => {
	it("has stable identity regardless of enumeration order and changes when bytes change", () => {
		const a = entry("Gamedata/icons/chair.png");
		const b = entry("Gamedata/config/FurnitureData.json", "{}");
		const first = createReleaseManifest([a, b]);
		expect(first).toEqual(createReleaseManifest([b, a]));
		expect(first.releaseId).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(createReleaseManifest([a, entry(b.path, "[]")]).releaseId).not.toBe(
			first.releaseId,
		);
		expect(JSON.stringify(first)).not.toContain("createdAt");
	});
	it.each([
		"../escape",
		"Gamedata/../escape",
		"/absolute",
		"Gamedata\\icons\\chair.png",
		"Gamedata//chair.png",
		"Gamedata/.git/config",
	])("rejects invalid path %s", (target) => {
		expect(() => createReleaseManifest([entry(target)])).toThrow();
	});
	it("rejects duplicate paths and invalid hashes", () => {
		expect(() =>
			createReleaseManifest([entry("Gamedata/a"), entry("Gamedata/a")]),
		).toThrow();
		expect(() =>
			createReleaseManifest([{ ...entry("Gamedata/a"), sha256: "bad" }]),
		).toThrow();
	});
	it("validates content hashes and manifest identity", async () => {
		const manifest = createReleaseManifest([entry("Gamedata/a")]);
		await expect(
			validateReleaseManifest(manifest, async () => digest("bytes")),
		).resolves.toBeUndefined();
		await expect(
			validateReleaseManifest(manifest, async () => digest("other")),
		).rejects.toThrow("mismatch");
		await expect(
			validateReleaseManifest(
				{ ...manifest, releaseId: "sha256:bad" },
				async () => digest("bytes"),
			),
		).rejects.toThrow("identity");
	});
});
