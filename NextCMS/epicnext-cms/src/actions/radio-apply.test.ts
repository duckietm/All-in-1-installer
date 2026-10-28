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

import { RadioApplications } from "@/lib/db";
import { applyDj } from "./radio-apply";

function buildForm(overrides: Record<string, string | undefined> = {}) {
	const f = new FormData();
	f.set("realName", "Jane Doe");
	f.set("age", "17");
	f.set("availability", "Weekends and evenings");
	f.set("motivation", "I love radio and DJing");
	f.set("experience", "two years");
	f.set("musicStyle", "electronic");
	for (const [k, v] of Object.entries(overrides)) {
		if (v === undefined) f.delete(k);
		else f.set(k, v);
	}
	return f;
}

describe("applyDj", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.failInsert = false;
		state.auth.mockResolvedValue({ user: { id: "5" } });
		state.rateLimit.mockResolvedValue({ ok: true });
		state.insert.mockResolvedValue([{ insertId: 1 }]);
	});

	it("submits a valid application and redirects to ?submitted=1", async () => {
		await expect(applyDj(buildForm())).rejects.toThrow(
			"/radio/apply?submitted=1",
		);
		expect(state.rateLimit).toHaveBeenCalledWith("radio-apply:5", 2, 300_000);
		expect(state.insert).toHaveBeenCalledOnce();
		expect(state.insert.mock.calls[0][0]).toBe(RadioApplications);
		expect(state.insert.mock.calls[0][1]).toMatchObject({
			userId: 5n,
			realName: "Jane Doe",
			age: 17,
			availability: "Weekends and evenings",
			motivation: "I love radio and DJing",
			experience: "two years",
			musicStyle: "electronic",
			status: "pending",
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
		expect(state.revalidatePath).toHaveBeenCalledWith("/radio/apply");
	});

	it("stores null for optional experience and music style", async () => {
		await expect(
			applyDj(buildForm({ experience: "", musicStyle: "" })),
		).rejects.toThrow("/radio/apply?submitted=1");
		expect(state.insert.mock.calls[0][1]).toMatchObject({
			experience: null,
			musicStyle: null,
		});
	});

	it("truncates oversized fields to the column bounds", async () => {
		await expect(
			applyDj(buildForm({ realName: "A".repeat(300) })),
		).rejects.toThrow("/radio/apply?submitted=1");
		const values = state.insert.mock.calls[0][1] as {
			realName: string;
		};
		expect(values.realName).toHaveLength(255);
	});

	it("rejects when required fields are missing or age is not a positive integer", async () => {
		await expect(applyDj(buildForm({ realName: "  " }))).rejects.toThrow(
			"/radio/apply?error=invalid",
		);
		await expect(applyDj(buildForm({ availability: "" }))).rejects.toThrow(
			"/radio/apply?error=invalid",
		);
		await expect(applyDj(buildForm({ motivation: undefined }))).rejects.toThrow(
			"/radio/apply?error=invalid",
		);
		await expect(applyDj(buildForm({ age: "0" }))).rejects.toThrow(
			"/radio/apply?error=invalid",
		);
		await expect(applyDj(buildForm({ age: "abc" }))).rejects.toThrow(
			"/radio/apply?error=invalid",
		);
		await expect(applyDj(buildForm({ age: "17.5" }))).rejects.toThrow(
			"/radio/apply?error=invalid",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("redirects with error=ratelimit when the rate limit is hit", async () => {
		state.rateLimit.mockResolvedValue({ ok: false, retryAfter: 300 });
		await expect(applyDj(buildForm())).rejects.toThrow(
			"/radio/apply?error=ratelimit",
		);
		expect(state.insert).not.toHaveBeenCalled();
		expect(state.revalidatePath).toHaveBeenCalledWith("/radio/apply");
	});

	it("redirects to /login when unauthenticated or the session id is not a valid user id", async () => {
		state.auth.mockResolvedValue({ user: { id: undefined } });
		await expect(applyDj(buildForm())).rejects.toThrow("/login");
		state.auth.mockResolvedValue({ user: { id: "0" } });
		await expect(applyDj(buildForm())).rejects.toThrow("/login");
		state.auth.mockResolvedValue({ user: { id: "abc" } });
		await expect(applyDj(buildForm())).rejects.toThrow("/login");
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("swallows internal errors and redirects with error=error", async () => {
		state.failInsert = true;
		await expect(applyDj(buildForm())).rejects.toThrow(
			"/radio/apply?error=error",
		);
		state.failInsert = false;
		state.auth.mockRejectedValueOnce(new Error("auth service down"));
		await expect(applyDj(buildForm())).rejects.toThrow(
			"/radio/apply?error=error",
		);
		expect(state.revalidatePath).toHaveBeenCalledWith("/radio/apply");
	});
});
