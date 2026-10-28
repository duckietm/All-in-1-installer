// @ts-nocheck
import { expect, it } from "vitest";
import { validateFurnitureAttachment } from "./furni-attachment";
import { createNitroBundle, encodePng } from "./swf/nitro-builder";

const png = encodePng(1, 1, Buffer.from([1, 2, 3, 255]));
it("accepts the matching bundle including color variants sharing a library", () => {
	const buffer = createNitroBundle({ name: "chair" }, png, "chair");
	expect(validateFurnitureAttachment(buffer, "chair*2")).toBe(buffer);
});
it("rejects a similarly named furniture bundle", () => {
	expect(() =>
		validateFurnitureAttachment(
			createNitroBundle({ name: "china_light" }, png, "china_light"),
			"nft_china_light",
		),
	).toThrow("does not belong");
});
it("rejects a renamed JSON entry with mismatching metadata", () => {
	expect(() =>
		validateFurnitureAttachment(
			createNitroBundle({ name: "china_light" }, png, "nft_china_light"),
			"nft_china_light",
		),
	).toThrow("does not belong");
});
it("rejects missing texture data", () => {
	expect(() =>
		validateFurnitureAttachment(
			createNitroBundle({ name: "chair" }, Buffer.from("not png"), "chair"),
			"chair",
		),
	).toThrow("PNG or WebP");
});
