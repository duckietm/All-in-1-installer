import { describe, expect, it } from "vitest";
import { createNitroBundle } from "../../swf/nitro-builder";
import {
	validateNitroBytes,
	validatePngBytes,
	validateSwfBytes,
} from "./download";

describe("import/core/download validators", () => {
	it("accepts FWS/CWS/ZWS swf magic", () => {
		expect(validateSwfBytes(Buffer.from("FWS\x06\x00\x00\x00\x00"))).toBe(true);
		expect(validateSwfBytes(Buffer.from("CWS\x06\x00\x00\x00\x00"))).toBe(true);
		expect(validateSwfBytes(Buffer.from("ZWS\x06\x00\x00\x00\x00"))).toBe(true);
	});

	it("rejects non-swf and too-short buffers", () => {
		expect(validateSwfBytes(Buffer.from("PNG\x00\x00\x00\x00\x00"))).toBe(
			false,
		);
		expect(validateSwfBytes(Buffer.from("FW"))).toBe(false);
	});

	it("accepts png magic and rejects others", () => {
		expect(
			validatePngBytes(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
		).toBe(true);
		expect(validatePngBytes(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(false);
	});
});

it("validates nitro bundles separately from PNG files", () => {
	const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const bundle = createNitroBundle({ name: "chair" }, png, "chair");
	expect(validateNitroBytes(bundle)).toBe(true);
	expect(validatePngBytes(bundle)).toBe(false);
	expect(validateNitroBytes(png)).toBe(false);
	expect(validateNitroBytes(Buffer.from("<html>Access denied</html>"))).toBe(
		false,
	);
});
