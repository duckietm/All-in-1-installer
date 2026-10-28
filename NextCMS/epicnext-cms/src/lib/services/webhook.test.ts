// @ts-nocheck
import { describe, expect, it, vi } from "vitest";

const selectLimit = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockFetch = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));

vi.mock("@/lib/db", () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: selectLimit,
				})),
			})),
		})),
	},
	WebsiteSetting: { key: "key", value: "value" },
}));

vi.mock("@/env", () => ({
	env: {
		DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/test",
		TELEGRAM_BOT_TOKEN: "",
		TELEGRAM_CHAT_ID: "",
	},
}));

global.fetch = mockFetch;

import { notify } from "./webhook";

describe("webhook", () => {
	it("sends a Discord notification when webhook URL is configured", async () => {
		notify({
			action: "ban",
			actor: "admin",
			target: "user1",
			targetId: 123,
		});
		await vi.waitFor(() => {
			expect(mockFetch).toHaveBeenCalledWith(
				"https://discord.com/api/webhooks/test",
				expect.objectContaining({
					method: "POST",
					headers: { "Content-Type": "application/json" },
				}),
			);
		});
	});

	it("does not throw when fetch fails", async () => {
		mockFetch.mockRejectedValueOnce(new Error("network error"));
		expect(() =>
			notify({ action: "ban", actor: "admin", target: "user1" }),
		).not.toThrow();
		await vi.waitFor(() => {
			expect(mockFetch).toHaveBeenCalled();
		});
	});
});
