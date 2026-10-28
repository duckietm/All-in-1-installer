// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	existing: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
}));
vi.mock("@/lib/db", async () => ({
	...(await import("@/db/schema")),
	db: {
		select: () => ({
			from: () => ({ where: () => ({ limit: mocks.existing }) }),
		}),
		insert: () => ({ values: mocks.insert }),
		update: () => ({ set: () => ({ where: mocks.update }) }),
	},
}));
vi.mock("@/lib/safe-action", () => ({
	adminAction:
		(
			options: { schema: { parse: (data: unknown) => unknown } },
			handler: (ctx: unknown) => unknown,
		) =>
		(data: unknown) =>
			handler({
				data: options.schema.parse(data),
				session: { user: { id: 7, username: "Staff" } },
			}),
	authAction: () => vi.fn(),
}));
vi.mock("@/lib/services/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/services/webhook", () => ({ notify: vi.fn() }));

vi.mock("@/lib/foundation/action", () => ({ handleActionError: vi.fn() }));
vi.mock("@/lib/permissions", async () => import("@/lib/permission-slugs"));

import { createEvent, updateEvent } from "./events";

const base = {
	title: "Event",
	description: "Details",
	typeId: 1,
	startsAt: new Date("2030-01-01"),
	status: "published" as const,
	isRecurring: 0,
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.existing.mockResolvedValue([
		{
			id: 1,
			status: "published",
			title: "Event",
			image: "/cover.png",
			startsAt: new Date("2030-01-01"),
			endsAt: new Date("2030-01-02"),
		},
	]);
	mocks.insert.mockResolvedValue([{ insertId: 1 }]);
	mocks.update.mockResolvedValue(undefined);
});
it("rejects invalid published event images before writing", async () => {
	await expect(
		createEvent({ ...base, image: "javascript:alert(1)" }),
	).rejects.toThrow("Check the event image");
	expect(mocks.insert).not.toHaveBeenCalled();
});
it("validates an update against existing dates before writing", async () => {
	await expect(
		updateEvent({ id: 1, endsAt: new Date("2029-12-01") }),
	).rejects.toThrow("Check the event image");
	expect(mocks.update).not.toHaveBeenCalled();
});
it("allows draft saves and partial updates with unchanged valid dates", async () => {
	await createEvent({ ...base, status: "draft", image: "javascript:alert(1)" });
	expect(mocks.insert).toHaveBeenCalledOnce();
	await updateEvent({ id: 1, title: "Changed", startsAt: undefined });
	expect(mocks.update).toHaveBeenCalledOnce();
});

it("does not bypass published preflight when a partial update omits status", async () => {
	await expect(
		updateEvent({ id: 1, image: "javascript:alert(1)" }),
	).rejects.toThrow("Check the event image");
	expect(mocks.update).not.toHaveBeenCalled();
});

it("allows explicitly removing an invalid image while publishing the draft", async () => {
	mocks.existing.mockResolvedValue([
		{
			id: 1,
			status: "draft",
			title: "Draft",
			image: "javascript:alert(1)",
			startsAt: new Date("2030-01-01"),
			endsAt: null,
		},
	]);
	await updateEvent({ id: 1, status: "published", image: "" });
	expect(mocks.update).toHaveBeenCalledOnce();
});
