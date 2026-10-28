// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	auth: vi.fn(async () => ({ user: { id: "5" } })),
	rateLimit: vi.fn(async () => ({ ok: true })),
	clientIp: vi.fn(async () => "203.0.113.9"),
	revalidatePath: vi.fn(),
	insert: vi.fn(async () => [{ insertId: 1 }]),
	failInsert: false,
}));

vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
vi.mock("next/navigation", () => ({
	redirect: (path: string) => {
		throw Object.assign(new Error(path), { digest: `NEXT_REDIRECT:${path}` });
	},
}));
vi.mock("@/lib/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/rate-limit", () => ({
	rateLimit: state.rateLimit,
	clientIp: state.clientIp,
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(() => []);
	return {
		...schema,
		db: {
			...fake,
			insert: (table: unknown) => ({
				values: (values: unknown) =>
					state.failInsert
						? Promise.reject(new Error("db down"))
						: state.insert(table, values),
			}),
		},
	};
});

import { RadioSongRequests } from "@/lib/db";
import { submitRequest } from "./radio-requests";

function buildForm(overrides: Record<string, string | undefined> = {}) {
	const f = new FormData();
	f.set("songTitle", "Never Gonna Give You Up");
	f.set("artist", "Rick Astley");
	for (const [k, v] of Object.entries(overrides)) {
		if (v === undefined) f.delete(k);
		else f.set(k, v);
	}
	return f;
}

describe("submitRequest", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.failInsert = false;
		state.auth.mockResolvedValue({ user: { id: "5" } });
		state.rateLimit.mockResolvedValue({ ok: true });
		state.insert.mockResolvedValue([{ insertId: 1 }]);
	});

	it("posts a request with song and artist, then redirects to ?posted=1", async () => {
		await expect(submitRequest(buildForm())).rejects.toThrow(
			"/radio/requests?posted=1",
		);
		expect(state.rateLimit).toHaveBeenCalledWith("radio-req:5", 5, 30_000);
		expect(state.insert).toHaveBeenCalledOnce();
		expect(state.insert.mock.calls[0][0]).toBe(RadioSongRequests);
		expect(state.insert.mock.calls[0][1]).toMatchObject({
			userId: 5n,
			songTitle: "Never Gonna Give You Up",
			artist: "Rick Astley",
			submittedAt: expect.any(Date),
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
		expect(state.revalidatePath).toHaveBeenCalledWith("/radio/requests");
	});

	it("stores null for whichever of song/artist is left empty", async () => {
		await expect(submitRequest(buildForm({ artist: "" }))).rejects.toThrow(
			"/radio/requests?posted=1",
		);
		expect(state.insert.mock.calls[0][1]).toMatchObject({
			songTitle: "Never Gonna Give You Up",
			artist: null,
		});

		state.insert.mockClear();
		await expect(
			submitRequest(buildForm({ songTitle: undefined })),
		).rejects.toThrow("/radio/requests?posted=1");
		expect(state.insert.mock.calls[0][1]).toMatchObject({
			songTitle: null,
			artist: "Rick Astley",
		});
	});

	it("truncates oversized song and artist fields", async () => {
		await expect(
			submitRequest(
				buildForm({ songTitle: "S".repeat(300), artist: "A".repeat(300) }),
			),
		).rejects.toThrow("/radio/requests?posted=1");
		const values = state.insert.mock.calls[0][1] as {
			songTitle: string;
			artist: string;
		};
		expect(values.songTitle).toHaveLength(255);
		expect(values.artist).toHaveLength(255);
	});

	it("rejects requests with neither song nor artist as empty", async () => {
		await expect(
			submitRequest(buildForm({ songTitle: "  ", artist: "" })),
		).rejects.toThrow("/radio/requests?error=empty");
		await expect(
			submitRequest(buildForm({ songTitle: undefined, artist: undefined })),
		).rejects.toThrow("/radio/requests?error=empty");
		expect(state.insert).not.toHaveBeenCalled();
		expect(state.revalidatePath).toHaveBeenCalledWith("/radio/requests");
	});

	it("redirects with error=ratelimit when throttled", async () => {
		state.rateLimit.mockResolvedValue({ ok: false, retryAfter: 10 });
		await expect(submitRequest(buildForm())).rejects.toThrow(
			"/radio/requests?error=ratelimit",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("redirects to /login when unauthenticated", async () => {
		state.auth.mockResolvedValue({ user: { id: undefined } });
		await expect(submitRequest(buildForm())).rejects.toThrow("/login");
		state.auth.mockResolvedValue({ user: { id: "-4" } });
		await expect(submitRequest(buildForm())).rejects.toThrow("/login");
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("redirects with error=error when the write fails", async () => {
		state.failInsert = true;
		await expect(submitRequest(buildForm())).rejects.toThrow(
			"/radio/requests?error=error",
		);
		state.failInsert = false;
		state.auth.mockRejectedValueOnce(new Error("boom"));
		await expect(submitRequest(buildForm())).rejects.toThrow(
			"/radio/requests?error=error",
		);
	});
});
