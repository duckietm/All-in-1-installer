import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { PERMS } from "@/lib/permission-slugs";

const mocks = vi.hoisted(() => ({
	attachment: vi.fn(),
	guard: vi.fn(),
	create: vi.fn(),
	read: vi.fn(),
	list: vi.fn(),
	page: vi.fn(),
	retry: vi.fn(),
	cancel: vi.fn(),
	after: vi.fn(),
	ping: vi.fn(),
	source: vi.fn(),
}));
vi.mock("@/lib/api-handler", () => ({
	withAdmin: (options: unknown, handler: unknown) => {
		mocks.guard(options);
		return handler;
	},
}));
vi.mock("next/server", async (original) => ({
	...(await original<typeof import("next/server")>()),
	after: mocks.after,
}));
vi.mock("@/lib/redis", () => ({ redis: { ping: mocks.ping } }));
vi.mock("@/lib/services/furni-job-worker", () => ({
	drainFurnitureImports: vi.fn(),
}));
vi.mock("@/lib/services/furni-job-store", async (original) => ({
	...(await original<typeof import("@/lib/services/furni-job-store")>()),
	ImportJobStore: class {
		create = mocks.create;
		read = mocks.read;
		list = mocks.list;
		page = mocks.page;
		retry = mocks.retry;
		requestCancellation = mocks.cancel;
	},
}));
vi.mock("@/lib/services/clone-sources", () => ({ getSource: mocks.source }));

vi.mock("@/lib/services/furni-attachment", () => ({
	readFurnitureAttachment: mocks.attachment,
}));

import { GET, PATCH, POST } from "./route";

const item = {
	id: 1,
	classname: "nft_china_light",
	name: "Lamp",
	description: "",
	type: "wallitem",
	revision: 70317,
	category: "other",
};
const ctx = { session: { user: { id: 7 } } } as never;
const request = (body: unknown) =>
	new NextRequest("http://localhost/cms_api/admin/studio/import-jobs", {
		method: "POST",
		body: JSON.stringify(body),
	});
beforeEach(() => {
	mocks.create.mockClear();
	mocks.read.mockRejectedValue(
		Object.assign(Error("missing"), { code: "ENOENT" }),
	);
	mocks.list.mockClear();
	mocks.after.mockClear();
	mocks.ping.mockResolvedValue("PONG");
	mocks.source.mockResolvedValue(null);
	mocks.create.mockImplementation((job) => job);
	mocks.list.mockResolvedValue([]);
});
it("requires asset import permission", () => {
	expect(mocks.guard).toHaveBeenCalledWith({ permission: PERMS.ASSETS_IMPORT });
});
it("queues a durable owner-scoped job and schedules execution after responding", async () => {
	const response = await POST(
		request({ id: randomUUID(), items: [item, item] }),
		ctx,
	);
	expect(response.status).toBe(200);
	expect(mocks.create.mock.calls[0][0]).toMatchObject({
		userId: 7,
		state: "queued",
		items: [{ ...item, state: "pending" }],
	});
	expect(mocks.after).toHaveBeenCalledOnce();
});
it("rejects traversal before saving work", async () => {
	expect(
		(
			await POST(
				request({
					id: randomUUID(),
					items: [{ ...item, classname: "../bad" }],
				}),
				ctx,
			)
		).status,
	).toBe(400);
	expect(mocks.create).not.toHaveBeenCalled();
});
it("does not accept work when the worker lease service is unavailable", async () => {
	mocks.ping.mockRejectedValue(Error("offline"));
	expect(
		(await POST(request({ id: randomUUID(), items: [item] }), ctx)).status,
	).toBe(503);
	expect(mocks.create).not.toHaveBeenCalled();
});
it("rejects a missing configured source", async () => {
	expect(
		(
			await POST(
				request({ id: randomUUID(), sourceId: "gone", items: [item] }),
				ctx,
			)
		).status,
	).toBe(404);
});
it("requests bounded owner-scoped history from the store", async () => {
	mocks.list.mockResolvedValue([{ id: "a", userId: 7 }]);
	const response = await GET(request({}), ctx);
	expect(mocks.list).toHaveBeenCalledWith({ userId: 7, limit: 30 });
	expect((await response.json()).jobs).toEqual([{ id: "a", userId: 7 }]);
});
it("requests cancellation with the authenticated owner", async () => {
	const id = randomUUID();
	mocks.cancel.mockResolvedValue({ id, cancelRequested: true });
	const response = await PATCH(request({ id }), ctx);
	expect(response.status).toBe(200);
	expect(mocks.cancel).toHaveBeenCalledWith(id, 7);
});
it("does not reveal other owners' jobs", async () => {
	mocks.cancel.mockResolvedValue(null);
	expect((await PATCH(request({ id: randomUUID() }), ctx)).status).toBe(404);
});
it("rejects unsafe cancellation IDs", async () => {
	expect((await PATCH(request({ id: "../other" }), ctx)).status).toBe(400);
});

it("delegates retry to owner-scoped server selection, ignoring client items", async () => {
	const id = randomUUID();
	mocks.retry.mockResolvedValue({ id });
	const response = await PATCH(
		request({ id, action: "retry", items: [item] }),
		ctx,
	);
	expect(response.status).toBe(200);
	expect(mocks.retry).toHaveBeenCalledWith(id, 7);
});
it("rejects retries while the queue is offline", async () => {
	mocks.ping.mockResolvedValue(null);
	mocks.retry.mockClear();
	expect(
		(await PATCH(request({ id: randomUUID(), action: "retry" }), ctx)).status,
	).toBe(503);
	expect(mocks.retry).not.toHaveBeenCalled();
});
it("loads a page only for the authenticated operator", async () => {
	mocks.page.mockResolvedValue({ jobs: [], nextCursor: null });
	const response = await GET(
		new NextRequest(
			"http://localhost/cms_api/admin/studio/import-jobs?page=1&userId=99",
		),
		ctx,
	);
	expect(response.status).toBe(200);
	expect(mocks.page).toHaveBeenCalledWith({
		userId: 7,
		limit: 20,
		before: undefined,
	});
});
it("rejects malformed history cursors", async () => {
	expect(
		(
			await GET(
				new NextRequest(
					"http://localhost/cms_api/admin/studio/import-jobs?page=1&before=broken",
				),
				ctx,
			)
		).status,
	).toBe(400);
});

it("validates recovery attachment ownership and classname before queueing", async () => {
	const id = randomUUID(),
		attachmentId = randomUUID();
	mocks.attachment.mockResolvedValue(Buffer.from("valid"));
	mocks.retry.mockResolvedValue({ id });
	expect(
		(
			await PATCH(
				request({ id, action: "retry", attachments: { chair: attachmentId } }),
				ctx,
			)
		).status,
	).toBe(200);
	expect(mocks.attachment).toHaveBeenCalledWith(attachmentId, "chair", 7);
	expect(mocks.retry).toHaveBeenCalledWith(id, 7, { chair: attachmentId });
});
it("rejects foreign or mismatched recovery files without retrying", async () => {
	mocks.retry.mockClear();
	mocks.attachment.mockRejectedValue(Error("owner mismatch"));
	expect(
		(
			await PATCH(
				request({
					id: randomUUID(),
					action: "retry",
					attachments: { chair: randomUUID() },
				}),
				ctx,
			)
		).status,
	).toBe(400);
	expect(mocks.retry).not.toHaveBeenCalled();
});
it("rejects invalid recovery attachment paths", async () => {
	mocks.retry.mockClear();
	expect(
		(
			await PATCH(
				request({
					id: randomUUID(),
					action: "retry",
					attachments: { "../chair": randomUUID() },
				}),
				ctx,
			)
		).status,
	).toBe(400);
	expect(mocks.retry).not.toHaveBeenCalled();
});

it("recovers accepted requests even when Redis and the source are unavailable", async () => {
	const body = { id: randomUUID(), sourceId: "source", items: [item] };
	mocks.source.mockResolvedValue({ id: "source" });
	const accepted = await POST(request(body), ctx);
	const saved = (await accepted.json()).job;
	mocks.read.mockResolvedValue({ ...saved, state: "completed" });
	mocks.ping.mockRejectedValue(Error("offline"));
	mocks.source.mockResolvedValue(null);
	const replay = await POST(request(body), ctx);
	expect(replay.status).toBe(200);
	expect((await replay.json()).job).toMatchObject({
		id: body.id,
		state: "completed",
	});
	expect(mocks.create).toHaveBeenCalledTimes(1);
});
it("rejects changed content for an accepted request instead of reporting false success", async () => {
	const body = { id: randomUUID(), items: [item] };
	const accepted = await POST(request(body), ctx);
	mocks.read.mockResolvedValue((await accepted.json()).job);
	const replay = await POST(request({ ...body, translate: true }), ctx);
	expect(replay.status).toBe(409);
	expect(mocks.create).toHaveBeenCalledTimes(1);
});
it("does not recover a different owner's request", async () => {
	const body = { id: randomUUID(), items: [item] };
	const accepted = await POST(request(body), ctx);
	mocks.read.mockResolvedValue({ ...(await accepted.json()).job, userId: 99 });
	const replay = await POST(request(body), ctx);
	expect(replay.status).toBe(409);
	expect((await replay.json()).job).toBeUndefined();
});
