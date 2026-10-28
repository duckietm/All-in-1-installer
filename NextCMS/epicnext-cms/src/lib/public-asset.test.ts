import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicAssetExists } from "./public-asset";

describe("publicAssetExists", () => {
	const originalCwd = process.cwd();
	let root: string;

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "public-asset-"));
		mkdirSync(join(root, "public", "assets"), { recursive: true });
		writeFileSync(join(root, "public", "assets", "present.png"), "");
		process.chdir(root);
	});

	afterAll(() => {
		process.chdir(originalCwd);
		rmSync(root, { recursive: true, force: true });
	});

	it("accepts a local file that exists", () => {
		expect(publicAssetExists("/assets/present.png")).toBe(true);
	});

	it("ignores query strings and hashes", () => {
		expect(publicAssetExists("/assets/present.png?v=2#x")).toBe(true);
	});

	it("rejects a local file that is missing", () => {
		expect(publicAssetExists("/assets/gone.png")).toBe(false);
	});

	it("rejects empty input", () => {
		expect(publicAssetExists(null)).toBe(false);
		expect(publicAssetExists(undefined)).toBe(false);
		expect(publicAssetExists("")).toBe(false);
	});

	it("trusts remote and protocol-relative URLs", () => {
		expect(publicAssetExists("https://cdn.example.com/a.png")).toBe(true);
		expect(publicAssetExists("http://cdn.example.com/a.png")).toBe(true);
		expect(publicAssetExists("//cdn.example.com/a.png")).toBe(true);
	});

	it("rejects non-http schemes", () => {
		expect(publicAssetExists("javascript:alert(1)")).toBe(false);
		expect(publicAssetExists("data:image/png;base64,AAAA")).toBe(false);
	});
});
