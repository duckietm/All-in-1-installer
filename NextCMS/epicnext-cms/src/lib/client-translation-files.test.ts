// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
	CLIENT_TRANSLATION_FILES,
	getClientTranslationFile,
} from "./client-translation-files";

describe("getClientTranslationFile", () => {
	it("returns the file for a known id", () => {
		const file = getClientTranslationFile("ui-texts-it");
		expect(file?.relPath).toBe("public/nitro-assets/config/UITexts.json5");
		expect(file?.format).toBe("json5");
	});

	it("returns undefined for unknown ids", () => {
		expect(getClientTranslationFile("../../etc/passwd")).toBeUndefined();
		expect(getClientTranslationFile("nope")).toBeUndefined();
	});
});

describe("CLIENT_TRANSLATION_FILES", () => {
	it("has unique ids (doubles as the path-traversal whitelist)", () => {
		const ids = CLIENT_TRANSLATION_FILES.map((f) => f.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("every relPath is inside the allowed public tree", () => {
		for (const f of CLIENT_TRANSLATION_FILES) {
			expect(f.relPath).toMatch(/^public\//);
			expect(f.relPath).not.toContain("..");
		}
	});

	it("formats are either json5 or json", () => {
		for (const f of CLIENT_TRANSLATION_FILES) {
			expect(["json5", "json"]).toContain(f.format);
		}
	});
});
