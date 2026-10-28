import { describe, expect, it } from "vitest";
import { tryRemoveLocalPhotoFile } from "./photo-files";

describe("tryRemoveLocalPhotoFile", () => {
	it("returns false for empty or nullish urls", async () => {
		expect(await tryRemoveLocalPhotoFile("")).toBe(false);
		expect(await tryRemoveLocalPhotoFile("   ")).toBe(false);
	});

	it("returns false for external urls not on this app origin", async () => {
		expect(
			await tryRemoveLocalPhotoFile("https://evil.example.com/photos/x.png"),
		).toBe(false);
	});

	it("returns false for urls without a leading slash", async () => {
		expect(await tryRemoveLocalPhotoFile("photos/x.png")).toBe(false);
	});

	it("blocks path traversal", async () => {
		expect(await tryRemoveLocalPhotoFile("/../../etc/passwd")).toBe(false);
		expect(await tryRemoveLocalPhotoFile("/photos/..%2f..%2fetc/passwd")).toBe(
			false,
		);
	});

	it("returns false when the target file does not exist", async () => {
		expect(
			await tryRemoveLocalPhotoFile("/photos/definitely-missing.png"),
		).toBe(false);
	});
});
