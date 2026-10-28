// @ts-nocheck

import path from "node:path";
import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirePermission } from "@/lib/admin/guard";
import { resolveMediaPath } from "@/lib/media-storage";
import { deleteMedia, uploadMedia, uploadMediaAndReturn } from "./admin-media";

vi.mock("@/lib/admin/guard", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ PERMS: { PAGES_EDIT: "pages.edit" } }));
vi.mock("@/lib/media-storage", () => {
	const root = path.join("/tmp", "nexst-test-media");
	return {
		MEDIA_ROOT: root,
		resolveMediaPath: vi.fn((name: string) => path.join(root, name)),
	};
});
vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn(),
	writeFile: vi.fn(),
	unlink: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const staff = { id: 1, rank: 7, username: "admin" };

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(requirePermission).mockResolvedValue(staff as never);
});

describe("uploadMedia", () => {
	it("returns error when no file provided", async () => {
		const result = await uploadMedia(new FormData());
		expect(result.ok).toBe(false);
		expect(result.error).toBe("No file provided");
	});
});

describe("uploadMediaAndReturn", () => {
	it("returns empty string when no file", async () => {
		expect(await uploadMediaAndReturn(new FormData())).toBe("");
	});
});

describe("deleteMedia", () => {
	it("deletes media file and revalidates", async () => {
		await deleteMedia("photo.png");
		expect(revalidatePath).toHaveBeenCalledWith("/cms_api/media");
	});

	it("skips deletion when path is outside media root", async () => {
		vi.mocked(resolveMediaPath).mockReturnValue("/etc/passwd");
		await deleteMedia("../../../etc/passwd");
		const { unlink } = await import("node:fs/promises");
		expect(unlink).not.toHaveBeenCalled();
	});
});
