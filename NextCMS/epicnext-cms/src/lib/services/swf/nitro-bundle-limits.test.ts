import { expect, it } from "vitest";
import { createNitroBundle, parseNitroBundle } from "./nitro-builder";

it("honors an explicit decompression limit for imported bundles", () => {
	const bundle = createNitroBundle(
		{ name: "chair", value: "a".repeat(4096) },
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		"chair",
	);
	expect(() => parseNitroBundle(bundle, { maxOutputLength: 1024 })).toThrow();
	expect(parseNitroBundle(bundle).json.name).toBe("chair");
});

it("refuses to write a bundle whose texture is neither PNG nor WebP", () => {
	expect(() =>
		createNitroBundle({ name: "chair" }, Buffer.from("not an image"), "chair"),
	).toThrow(/PNG or WebP/);
});
