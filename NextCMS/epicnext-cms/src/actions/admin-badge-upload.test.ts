// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requirePermission: vi.fn(async () => ({ id: 1, rank: 7, username: "a" })),
	writeFile: vi.fn(async () => undefined),
	toBadgeGif: vi.fn(async () => Buffer.from("gif")),
	logStaffActivity: vi.fn(async () => undefined),
	redirect: vi.fn((url: string) => {
		throw new Error(`NEXT_REDIRECT:${url}`);
	}),
}));

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/permissions", () => ({
	PERMS: { CATALOG_EDIT: "admin.catalog.edit" },
}));
vi.mock("@/lib/images/badge-gif", () => ({ toBadgeGif: mocks.toBadgeGif }));
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: mocks.logStaffActivity,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("node:fs/promises", () => ({ writeFile: mocks.writeFile }));

import { PERMS } from "@/lib/permissions";
import { uploadBadge } from "./admin-badge-upload";

function form(fields: Record<string, string | File>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
}

function png(size = 4, type = "image/png") {
	return new File([new Uint8Array(size)], "badge.png", { type });
}

async function run(fd: FormData): Promise<Error | null> {
	try {
		await uploadBadge(fd);
		return null;
	} catch (error) {
		return error as Error;
	}
}

const DIR = "/var/www/atom-nexst/storage/badges";

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv("BADGE_UPLOAD_DIR", DIR);
	mocks.requirePermission.mockResolvedValue({ id: 1, rank: 7, username: "a" });
	mocks.writeFile.mockResolvedValue(undefined);
	mocks.toBadgeGif.mockResolvedValue(Buffer.from("gif"));
	mocks.logStaffActivity.mockResolvedValue(undefined);
	mocks.redirect.mockImplementation((url: string) => {
		throw new Error(`NEXT_REDIRECT:${url}`);
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("uploadBadge", () => {
	it("normalises the image and writes it as <code>.gif", async () => {
		const error = await run(form({ code: "  ACH_1 ", file: png() }));

		expect(mocks.requirePermission).toHaveBeenCalledWith(PERMS.CATALOG_EDIT);
		expect(mocks.toBadgeGif).toHaveBeenCalledWith(expect.any(Buffer));
		expect(mocks.writeFile).toHaveBeenCalledTimes(1);
		const [target, gif] = mocks.writeFile.mock.calls[0] as [unknown, Buffer];
		expect(String(target)).toBe(`${DIR}/ACH_1.gif`);
		expect(gif).toEqual(Buffer.from("gif"));
		expect(mocks.logStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "badge_upload",
				description: 'Uploaded badge image "ACH_1.gif"',
				targetType: "badge",
			}),
		);
		expect(mocks.redirect).toHaveBeenCalledWith(
			`/admin/badges?uploaded=${encodeURIComponent("ACH_1")}`,
		);
		expect(error?.message).toContain("NEXT_REDIRECT");
	});

	it("accepts GIF uploads", async () => {
		const error = await run(form({ code: "G1", file: png(4, "image/gif") }));

		expect(mocks.writeFile).toHaveBeenCalledTimes(1);
		expect(error?.message).toContain("NEXT_REDIRECT");
	});

	it("rejects when the badge directory is not configured", async () => {
		vi.stubEnv("BADGE_UPLOAD_DIR", "");

		const error = await run(form({ code: "A", file: png() }));

		expect(mocks.redirect).toHaveBeenCalledWith(
			`/admin/badges?error=${encodeURIComponent("Badge upload directory not configured")}`,
		);
		expect(mocks.writeFile).not.toHaveBeenCalled();
		expect(error?.message).toContain("NEXT_REDIRECT");
	});

	it("rejects a request with no code field", async () => {
		const error = await run(form({ file: png() }));

		expect(mocks.redirect).toHaveBeenCalledWith(
			`/admin/badges?error=${encodeURIComponent("Invalid badge code (use A-Z, 0-9, _ or -, max 64 chars)")}`,
		);
		expect(error?.message).toContain("NEXT_REDIRECT");
	});

	it("rejects an invalid badge code", async () => {
		const error = await run(form({ code: "bad code!", file: png() }));

		expect(mocks.redirect).toHaveBeenCalledWith(
			`/admin/badges?error=${encodeURIComponent("Invalid badge code (use A-Z, 0-9, _ or -, max 64 chars)")}`,
		);
		expect(mocks.writeFile).not.toHaveBeenCalled();
		expect(error?.message).toContain("NEXT_REDIRECT");
	});

	it("rejects a missing file", async () => {
		const error = await run(form({ code: "A" }));

		expect(mocks.redirect).toHaveBeenCalledWith(
			`/admin/badges?error=${encodeURIComponent("No file uploaded")}`,
		);
		expect(error?.message).toContain("NEXT_REDIRECT");
	});

	it("rejects an empty file", async () => {
		const error = await run(form({ code: "A", file: png(0) }));

		expect(mocks.redirect).toHaveBeenCalledWith(
			`/admin/badges?error=${encodeURIComponent("Uploaded file is empty")}`,
		);
		expect(error?.message).toContain("NEXT_REDIRECT");
	});

	it("rejects a file larger than 1MB", async () => {
		const error = await run(form({ code: "A", file: png(1024 * 1024 + 1) }));

		expect(mocks.redirect).toHaveBeenCalledWith(
			`/admin/badges?error=${encodeURIComponent("File too large (max 1MB)")}`,
		);
		expect(error?.message).toContain("NEXT_REDIRECT");
	});

	it("rejects a disallowed mime type", async () => {
		const error = await run(form({ code: "A", file: png(4, "image/jpeg") }));

		expect(mocks.redirect).toHaveBeenCalledWith(
			`/admin/badges?error=${encodeURIComponent("File must be a GIF or PNG image")}`,
		);
		expect(error?.message).toContain("NEXT_REDIRECT");
	});

	it("reports a processing failure when the converter throws", async () => {
		mocks.toBadgeGif.mockRejectedValueOnce(new Error("sharp failed"));

		const error = await run(form({ code: "A", file: png() }));

		expect(mocks.redirect).toHaveBeenCalledWith(
			`/admin/badges?error=${encodeURIComponent("Could not process or write the badge file")}`,
		);
		expect(mocks.writeFile).not.toHaveBeenCalled();
		expect(error?.message).toContain("NEXT_REDIRECT");
	});

	it("reports a processing failure when the write fails", async () => {
		mocks.writeFile.mockRejectedValueOnce(new Error("EACCES"));

		const error = await run(form({ code: "A", file: png() }));

		expect(mocks.redirect).toHaveBeenCalledWith(
			`/admin/badges?error=${encodeURIComponent("Could not process or write the badge file")}`,
		);
		expect(error?.message).toContain("NEXT_REDIRECT");
	});

	it("rejects a resolved target outside the configured directory", async () => {
		vi.stubEnv("BADGE_UPLOAD_DIR", "/");

		const error = await run(form({ code: "escape", file: png() }));

		expect(mocks.redirect).toHaveBeenCalledTimes(1);
		expect(mocks.redirect).toHaveBeenCalledWith(
			`/admin/badges?error=${encodeURIComponent("Invalid path")}`,
		);
		expect(mocks.toBadgeGif).not.toHaveBeenCalled();
		expect(mocks.writeFile).not.toHaveBeenCalled();
		expect(error?.message).toContain("error=Invalid%20path");
	});

	it("propagates a permission denial", async () => {
		mocks.requirePermission.mockRejectedValueOnce(new Error("redirect:/admin"));

		const error = await run(form({ code: "A", file: png() }));

		expect(error?.message).toBe("redirect:/admin");
		expect(mocks.redirect).not.toHaveBeenCalled();
		expect(mocks.writeFile).not.toHaveBeenCalled();
	});
});
