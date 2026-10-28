import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	read: vi.fn(),
	write: vi.fn(),
	rename: vi.fn(),
	mkdir: vi.fn(),
	rm: vi.fn(),
	generate: vi.fn(),
}));
vi.mock("node:fs", () => ({
	// `bundle-file` resolves the live bundle (`.hab`, else legacy `.nitro`)
	// through existsSync before the route reads it.
	existsSync: () => true,
	promises: {
		readFile: mocks.read,
		writeFile: mocks.write,
		rename: mocks.rename,
		mkdir: mocks.mkdir,
		rm: mocks.rm,
	},
}));
vi.mock("@/lib/api-handler", () => ({
	withAdmin: (_: unknown, h: unknown) => h,
}));
vi.mock("@/lib/services/furni-asset-dirs", () => ({
	getFurniAssetDirs: async () => ({ nitroDir: "/nitro" }),
}));
vi.mock("@/lib/services/furni-data", () => ({
	withFurniDataLock: (f: () => Promise<unknown>) => f(),
}));
vi.mock("@/lib/services/catalog-git-queue", () => ({
	withCatalogExport: (f: () => Promise<unknown>) => f(),
}));
vi.mock("@/lib/furni/nitro-scale32", () => ({
	generateScale32: mocks.generate,
}));
vi.mock("@/lib/services/swf/nitro-builder", () => ({
	parseNitroBundle: () => ({ json: { assets: {} } }),
}));

import { emptyRouteContext } from "@/test/route-context";
import { POST } from "./route";

const original = Buffer.from("original"),
	generated = Buffer.from("generated"),
	hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const request = (body: object) =>
	new NextRequest("http://localhost/cms_api/admin/studio/nitro-scale32", {
		method: "POST",
		body: JSON.stringify({ classname: "chair", ...body }),
	});
beforeEach(() => {
	vi.clearAllMocks();
	mocks.read.mockResolvedValue(original);
	mocks.generate.mockResolvedValue({
		bundle: generated,
		before: "before",
		after: "after",
		count: 1,
	});
});
it("preview does not write anything", async () => {
	expect(
		(await POST(request({ action: "preview" }), emptyRouteContext())).status,
	).toBe(200);
	expect(mocks.write).not.toHaveBeenCalled();
});
it("rejects stale source before generation or writes", async () => {
	expect(
		(
			await POST(
				request({ action: "apply", expectedHash: hash(generated) }),
				emptyRouteContext(),
			)
		).status,
	).toBe(409);
	expect(mocks.generate).not.toHaveBeenCalled();
	expect(mocks.write).not.toHaveBeenCalled();
});
it("backs up the original before replacing the bundle", async () => {
	expect(
		(
			await POST(
				request({ action: "apply", expectedHash: hash(original) }),
				emptyRouteContext(),
			)
		).status,
	).toBe(200);
	expect(mocks.write.mock.calls[0][1]).toEqual(original);
	expect(mocks.write.mock.calls[1][1]).toEqual(generated);
	expect(mocks.rename).toHaveBeenCalledOnce();
});
it("restores the exact backup after checking the current hash", async () => {
	mocks.read.mockResolvedValueOnce(generated).mockResolvedValueOnce(original);
	expect(
		(
			await POST(
				request({
					action: "restore",
					expectedHash: hash(generated),
					backupHash: hash(original),
				}),
				emptyRouteContext(),
			)
		).status,
	).toBe(200);
	expect(mocks.write.mock.calls[0][1]).toEqual(original);
});
it("does not replace the live file when backup writing fails", async () => {
	mocks.write.mockRejectedValueOnce(Error("disk full"));
	expect(
		(
			await POST(
				request({ action: "apply", expectedHash: hash(original) }),
				emptyRouteContext(),
			)
		).status,
	).toBe(422);
	expect(mocks.rename).not.toHaveBeenCalled();
});
