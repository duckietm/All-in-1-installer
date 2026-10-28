// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	id: "42" as string | undefined,
	values: null as Record<string, unknown> | null,
	fail: false,
}));
vi.mock("@/lib/auth", () => ({
	auth: async () => ({ user: { id: state.id } }),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
	redirect: (path: string) => {
		throw new Error(path);
	},
}));
vi.mock("@/lib/db", () => ({
	db: {
		insert: () => ({
			values: (values: Record<string, unknown>) => {
				state.values = values;
				return {
					onDuplicateKeyUpdate: async () => {
						if (state.fail) throw new Error("offline");
					},
				};
			},
		}),
	},
}));

import { saveProfilePrivacy } from "./profile-privacy";

describe("save profile privacy", () => {
	beforeEach(() => {
		state.id = "42";
		state.values = null;
		state.fail = false;
	});
	it("uses the session owner even when another user is supplied in the form", async () => {
		const form = new FormData();
		form.set("userId", "99");
		form.set("wallet", "on");
		await expect(saveProfilePrivacy(form)).rejects.toThrow(
			"/settings?privacy=saved",
		);
		expect(state.values).toEqual({
			userId: 42,
			wallet: true,
			online: false,
			friends: false,
			photos: false,
			registered: false,
		});
	});
	it("rejects unauthenticated writes", async () => {
		state.id = undefined;
		await expect(saveProfilePrivacy(new FormData())).rejects.toThrow("/login");
		expect(state.values).toBeNull();
	});
	it("never reports success after a database failure", async () => {
		state.fail = true;
		await expect(saveProfilePrivacy(new FormData())).rejects.toThrow(
			"/settings?privacy=error",
		);
	});
});
