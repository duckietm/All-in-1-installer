// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requirePermission: vi.fn(),
	insertValues: vi.fn(async () => [{ insertId: 1 }]),
	updateSet: vi.fn(),
	updateWhere: vi.fn(async () => [{ affectedRows: 1 }]),
	deleteWhere: vi.fn(async () => [{ affectedRows: 1 }]),
	revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/permissions", () => ({
	PERMS: { PAGES_EDIT: "admin.pages.edit" },
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	return {
		...schema,
		db: {
			insert: vi.fn(() => ({ values: mocks.insertValues })),
			update: vi.fn(() => ({ set: mocks.updateSet })),
			delete: vi.fn(() => ({ where: mocks.deleteWhere })),
		},
	};
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { PERMS } from "@/lib/permissions";
import {
	createEmailTemplate,
	deleteEmailTemplate,
	updateEmailTemplate,
} from "./admin-email-templates";

function form(data: Record<string, string>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(data)) f.set(k, v);
	return f;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requirePermission.mockResolvedValue({ id: 1, rank: 7, username: "a" });
	mocks.insertValues.mockResolvedValue([{ insertId: 1 }]);
	mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
	mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
	mocks.deleteWhere.mockResolvedValue([{ affectedRows: 1 }]);
});

describe("createEmailTemplate", () => {
	it("creates a template with trimmed fields and active flag", async () => {
		await createEmailTemplate(
			form({
				name: "  Welcome  ",
				subject: " Hi ",
				body: "Hello",
				variables: "{{username}}",
				isActive: "on",
			}),
		);

		expect(mocks.requirePermission).toHaveBeenCalledWith(PERMS.PAGES_EDIT);
		expect(mocks.insertValues).toHaveBeenCalledWith({
			name: "Welcome",
			subject: "Hi",
			body: "Hello",
			variables: "{{username}}",
			isActive: true,
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/email-templates");
	});

	it("stores null variables and inactive when the variable field is blank", async () => {
		await createEmailTemplate(
			form({ name: "Welcome", subject: "Hi", body: "Hello" }),
		);

		expect(mocks.insertValues).toHaveBeenCalledWith({
			name: "Welcome",
			subject: "Hi",
			body: "Hello",
			variables: null,
			isActive: false,
		});
	});

	it("returns early when every field is absent", async () => {
		await createEmailTemplate(new FormData());

		expect(mocks.insertValues).not.toHaveBeenCalled();
	});

	it("returns early when a required field is missing", async () => {
		await createEmailTemplate(form({ name: "", subject: "Hi", body: "Hello" }));
		await createEmailTemplate(form({ name: "Hi", subject: "", body: "Hello" }));
		await createEmailTemplate(form({ name: "Hi", subject: "Hi", body: "" }));

		expect(mocks.insertValues).not.toHaveBeenCalled();
	});
});

describe("updateEmailTemplate", () => {
	it("updates the subject, body, variables and active flag", async () => {
		await updateEmailTemplate(
			form({
				id: "42",
				subject: " Updated ",
				body: "Body",
				variables: "{{x}}",
				isActive: "1",
			}),
		);

		expect(mocks.updateSet).toHaveBeenCalledWith({
			subject: "Updated",
			body: "Body",
			variables: "{{x}}",
			isActive: true,
		});
		expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/email-templates");
	});

	it("returns early for a blank or invalid id", async () => {
		await updateEmailTemplate(form({ id: "", subject: "a", body: "b" }));
		await updateEmailTemplate(
			form({ id: "not-a-number", subject: "a", body: "b" }),
		);

		expect(mocks.updateSet).not.toHaveBeenCalled();
	});

	it("returns early when subject or body is missing", async () => {
		await updateEmailTemplate(form({ id: "1", subject: "", body: "b" }));
		await updateEmailTemplate(form({ id: "1", subject: "a", body: "" }));

		expect(mocks.updateSet).not.toHaveBeenCalled();
	});

	it("returns early when every field is absent", async () => {
		await updateEmailTemplate(new FormData());

		expect(mocks.updateSet).not.toHaveBeenCalled();
	});

	it("returns early when the id is present but subject and body are absent", async () => {
		await updateEmailTemplate(form({ id: "1" }));

		expect(mocks.updateSet).not.toHaveBeenCalled();
	});

	it("stores null variables and inactive flag when omitted", async () => {
		await updateEmailTemplate(form({ id: "3", subject: "s", body: "b" }));

		expect(mocks.updateSet).toHaveBeenCalledWith({
			subject: "s",
			body: "b",
			variables: null,
			isActive: false,
		});
	});
});

describe("deleteEmailTemplate", () => {
	it("deletes the template by id", async () => {
		await deleteEmailTemplate(form({ id: "7" }));

		expect(mocks.requirePermission).toHaveBeenCalledWith(PERMS.PAGES_EDIT);
		expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/email-templates");
	});

	it("does nothing for an invalid id", async () => {
		await deleteEmailTemplate(form({ id: "0" }));

		expect(mocks.deleteWhere).not.toHaveBeenCalled();
	});

	it("propagates a permission denial", async () => {
		mocks.requirePermission.mockRejectedValueOnce(new Error("redirect:/admin"));

		await expect(deleteEmailTemplate(form({ id: "1" }))).rejects.toThrow(
			"redirect:/admin",
		);
		expect(mocks.deleteWhere).not.toHaveBeenCalled();
	});
});
