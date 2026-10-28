// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectLimit, selectWhere, insertOnDup, mockSendMail, mockRedirect } =
	vi.hoisted(() => ({
		selectLimit: vi.fn(),
		insertOnDup: vi.fn().mockResolvedValue({}),
		selectWhere: vi.fn(() => Promise.resolve([] as Array<{ id: number }>)),
		mockSendMail: vi.fn(),
		mockRedirect: vi.fn(),
	}));

vi.mock("next/navigation", () => ({
	redirect: (...args: unknown[]) => {
		mockRedirect(...args);
		throw new Error("redirect");
	},
}));

vi.mock("@/lib/db", () => {
	return {
		db: {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: selectLimit,
						// Matches the deterministic `.orderBy(asc(User.id))` list
						// reads used to resolve duplicate addresses.
						orderBy: vi.fn(() => ({
							// biome-ignore lint/suspicious/noThenProperty: Drizzle query thenable mock
							then(
								resolve: (v: unknown) => void,
								reject: (e: unknown) => void,
							) {
								return Promise.resolve(selectWhere()).then(resolve, reject);
							},
						})),
					})),
				})),
			})),
			insert: vi.fn(() => ({
				values: vi.fn(() => ({
					onDuplicateKeyUpdate: insertOnDup,
				})),
			})),
		},
		User: { id: "id", mail: "mail" },
		PasswordReset: { email: "email", token: "token", createdAt: "createdAt" },
	};
});

vi.mock("@/lib/services/email", () => ({
	sendMail: mockSendMail,
}));

vi.mock("@/lib/services/captcha", () => ({
	captchaConfig: vi.fn().mockResolvedValue({
		provider: "none",
		siteKey: "",
		field: "",
	}),
	verifyCaptcha: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/rate-limit", () => ({
	rateLimit: vi.fn().mockResolvedValue({ ok: true, retryAfter: 0 }),
	clientIp: vi.fn().mockResolvedValue("127.0.0.1"),
}));

vi.mock("@/env", () => ({
	env: { APP_URL: "http://localhost:3000", HOTEL_NAME: "TestHotel" },
}));

import { requestReset } from "./password-reset";

beforeEach(() => {
	vi.clearAllMocks();
	insertOnDup.mockResolvedValue({});
});

describe("requestReset", () => {
	it("sends a reset email when the user exists", async () => {
		selectLimit.mockResolvedValue([{ id: 1 }]);
		selectWhere.mockResolvedValue([{ id: 1 }]);

		const fd = new FormData();
		fd.set("email", "user@example.com");

		await expect(requestReset(fd)).rejects.toThrow("redirect");

		expect(selectWhere).toHaveBeenCalled();
		expect(insertOnDup).toHaveBeenCalled();
		expect(mockSendMail).toHaveBeenCalledWith(
			"user@example.com",
			expect.stringContaining("password reset"),
			expect.stringContaining("http://localhost:3000/reset"),
		);
	});

	it("does not send email when user is not found", async () => {
		selectLimit.mockResolvedValue([]);
		selectWhere.mockResolvedValue([]);

		const fd = new FormData();
		fd.set("email", "unknown@example.com");

		await expect(requestReset(fd)).rejects.toThrow("redirect");
		expect(mockSendMail).not.toHaveBeenCalled();
	});

	it("rate limits and does not throw on email without @", async () => {
		const fd = new FormData();
		fd.set("email", "not-an-email");

		await expect(requestReset(fd)).rejects.toThrow("redirect");
		expect(selectLimit).not.toHaveBeenCalled();
	});
});
