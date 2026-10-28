// @ts-nocheck
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/import/core/download", () => ({
	downloadFile: vi.fn(async () => ({ ok: true, size: 100 })),
}));
vi.mock("@/lib/services/pet-source", () => ({
	CANONICAL_PETS: ["dog", "cat"],
	resolvePetSwfUrl: vi.fn(async (lib: string) => `https://x/${lib}.swf`),
}));
const convertSwfToNitro = vi.fn(() => ({
	bundle: Buffer.from("nitro"),
	warnings: [],
}));
vi.mock("@/lib/services/swf-to-nitro", () => ({
	convertSwfToNitro: (...a: unknown[]) =>
		convertSwfToNitro(...(a as Parameters<typeof convertSwfToNitro>)),
}));
// `vi.mock` factories are hoisted, so these handles have to exist before the
// module body runs or the fs factory hits the temporal dead zone.
const { writeFile, unlink, exists } = vi.hoisted(() => ({
	writeFile: vi.fn(async () => {}),
	unlink: vi.fn(async () => {}),
	exists: vi.fn((_: string) => false),
}));
vi.mock("node:fs", async (orig) => {
	const real = (await orig()) as typeof import("node:fs");
	return {
		...real,
		existsSync: exists,
		promises: {
			...real.promises,
			readFile: vi.fn(async () => Buffer.from("CWS")),
			writeFile,
			mkdir: vi.fn(async () => {}),
			unlink,
		},
	};
});

import { deleteImportedPet, importSinglePet } from "./pet-import";

describe("pet-import.importSinglePet", () => {
	it("downloads, converts, writes .hab", async () => {
		const r = await importSinglePet({ lib: "dog" });
		expect(r.ok).toBe(true);
		expect(convertSwfToNitro).toHaveBeenCalled();
		// Pets follow the same convention as furniture: `.hab` on disk.
		expect(writeFile).toHaveBeenCalledWith(
			expect.stringContaining("dog.hab"),
			expect.any(Buffer),
		);
	});

	it("fails cleanly when conversion throws", async () => {
		convertSwfToNitro.mockImplementationOnce(() => {
			throw new Error("bad swf");
		});
		const r = await importSinglePet({ lib: "cat" });
		expect(r.ok).toBe(false);
		expect(r.error).toContain("conversion");
	});
});

describe("pet-import.deleteImportedPet", () => {
	beforeEach(() => {
		writeFile.mockClear();
		unlink.mockClear();
		exists.mockReset();
	});

	it("reports nothing deleted when the pet was never imported", async () => {
		exists.mockReturnValue(false);

		await expect(deleteImportedPet("dog")).resolves.toEqual({
			deletedFile: false,
		});
		expect(unlink).not.toHaveBeenCalled();
	});

	// A re-import writes `.hab`; leaving a legacy `.nitro` behind would let the
	// client pick up the stale bundle, so both are cleared.
	it("clears both the `.hab` and the legacy `.nitro`", async () => {
		exists.mockReturnValue(true);

		await expect(deleteImportedPet("dog")).resolves.toEqual({
			deletedFile: true,
		});
		expect(unlink).toHaveBeenCalledWith(expect.stringContaining("dog.hab"));
		expect(unlink).toHaveBeenCalledWith(expect.stringContaining("dog.nitro"));
	});
});
