import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	feed: vi.fn(),
	mark: vi.fn(),
	preferences: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/features/notifications/server", () => ({ notifications: mocks }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }) }));

import { GET, POST } from "./route";

function request(body: unknown, origin = "https://hotel.test") {
	return new Request("https://hotel.test/cms_api/notifications", {
		method: "POST",
		headers: { origin, "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.auth.mockResolvedValue({ user: { id: "7" } });
	mocks.feed.mockResolvedValue({ items: [] });
	mocks.mark.mockResolvedValue(true);
});
describe("notification route authorization", () => {
	it("rejects anonymous reads and writes without accessing data", async () => {
		mocks.auth.mockResolvedValue(null);
		expect(
			(await GET(new Request("https://hotel.test/cms_api/notifications"))).status,
		).toBe(401);
		expect(
			(await POST(request({ action: "read", key: "support:1" }))).status,
		).toBe(401);
		expect(mocks.feed).not.toHaveBeenCalled();
		expect(mocks.mark).not.toHaveBeenCalled();
	});
	it("uses the session identity even when a query supplies another account", async () => {
		await GET(
			new Request("https://hotel.test/cms_api/notifications?userId=99&page=2"),
		);
		expect(mocks.feed).toHaveBeenCalledWith(7, 2);
	});
	it("rejects cross-origin mutations", async () => {
		expect(
			(
				await POST(
					request(
						{ action: "read", key: "support:1" },
						"https://attacker.test",
					),
				)
			).status,
		).toBe(403);
		expect(mocks.mark).not.toHaveBeenCalled();
	});
	it("rejects an injected account in writes", async () => {
		expect(
			(await POST(request({ action: "read", key: "support:1", userId: 99 })))
				.status,
		).toBe(400);
		expect(mocks.mark).not.toHaveBeenCalled();
	});
	it("rejects unavailable and other account notifications", async () => {
		mocks.mark.mockResolvedValue(false);
		expect(
			(await POST(request({ action: "read", key: "support:1" }))).status,
		).toBe(404);
		expect(mocks.mark).toHaveBeenCalledWith(7, "support:1");
	});
	it("persists category preferences under the authenticated account", async () => {
		const preferences = { support: false, friends: true, events: false };
		expect(
			(await POST(request({ action: "preferences", preferences }))).status,
		).toBe(200);
		expect(mocks.preferences).toHaveBeenCalledWith(7, preferences);
	});
	it("does not turn an infrastructure failure into an empty feed", async () => {
		mocks.feed.mockRejectedValue(new Error("Database unavailable"));
		expect(
			(await GET(new Request("https://hotel.test/cms_api/notifications"))).status,
		).toBe(503);
	});
});

it("returns a failure when saving read state or preferences fails", async () => {
	mocks.mark.mockRejectedValue(new Error("Database unavailable"));
	expect(
		(await POST(request({ action: "read", key: "support:1" }))).status,
	).toBe(503);
	mocks.preferences.mockRejectedValue(new Error("Database unavailable"));
	expect(
		(
			await POST(
				request({
					action: "preferences",
					preferences: { support: true, friends: false, events: true },
				}),
			)
		).status,
	).toBe(503);
});

it("rejects incomplete and foreign-account preferences", async () => {
	for (const body of [
		{ action: "preferences", preferences: { support: false } },
		{
			action: "preferences",
			userId: 99,
			preferences: { support: false, friends: true, events: true },
		},
	])
		expect((await POST(request(body))).status).toBe(400);
	expect(mocks.preferences).not.toHaveBeenCalled();
});
