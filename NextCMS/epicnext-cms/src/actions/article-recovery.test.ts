// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	version: 0,
	update: vi.fn(),
	insert: vi.fn(),
	permission: vi.fn(),
}));
vi.mock("@/lib/admin/guard", () => ({ requirePermission: state.permission }));
vi.mock("@/lib/permissions", () => ({ PERMS: { NEWS_EDIT: "news.edit" } }));
vi.mock("@/lib/db", async () => {
	const tx = {
		insert: (table: unknown) => ({
			values: (value: unknown) => {
				state.insert(table, value);
				return { onDuplicateKeyUpdate: async () => {} };
			},
		}),
		select: () => ({
			from: () => ({
				where: () => ({ for: async () => [{ version: state.version }] }),
			}),
		}),
		update: (table: unknown) => ({
			set: (value: unknown) => {
				state.update(table, value);
				return { where: async () => {} };
			},
		}),
	};
	return {
		...(await import("@/db/schema")),
		db: { transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) },
	};
});

import { ArticleDrafts } from "@/db/article-editor";
import { autosaveArticle } from "./article-recovery";

function draft() {
	const form = new FormData();
	form.set("title", "Incomplete title");
	form.set("status", "published");
	form.set("fullStory", "Work in progress");
	return form;
}
beforeEach(() => {
	vi.clearAllMocks();
	state.version = 0;
	state.permission.mockResolvedValue({ id: 17 });
});
it("stores incomplete editor content only in a private draft table even when publication is selected", async () => {
	expect(await autosaveArticle("new", 0, draft())).toEqual({
		ok: true,
		version: 1,
	});
	expect(state.permission).toHaveBeenCalledWith("news.edit");
	expect(state.insert).toHaveBeenCalledWith(
		ArticleDrafts,
		expect.objectContaining({ userId: 17, articleKey: "new" }),
	);
	expect(state.update).toHaveBeenCalledOnce();
	expect(state.update).toHaveBeenCalledWith(
		ArticleDrafts,
		expect.objectContaining({ version: 1 }),
	);
});
it("does not replace a more recent draft from another tab", async () => {
	state.version = 4;
	expect(await autosaveArticle("new", 3, draft())).toEqual({ ok: false });
	expect(state.update).not.toHaveBeenCalled();
});
it("does not access storage when the editor permission is denied", async () => {
	state.permission.mockRejectedValue(new Error("denied"));
	await expect(autosaveArticle("new", 0, draft())).rejects.toThrow("denied");
	expect(state.insert).not.toHaveBeenCalled();
});
it("rejects excessive article content before writing", async () => {
	const form = draft();
	form.set("fullStory", "x".repeat(500_001));
	await expect(autosaveArticle("new", 0, form)).rejects.toThrow("draftInvalid");
	expect(state.insert).not.toHaveBeenCalled();
});
