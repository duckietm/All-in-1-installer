// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	exec: vi.fn(),
	write: vi.fn(),
	mkdir: vi.fn(),
	api: vi.fn(),
	env: {
		RESEND_API_KEY: "",
		SMTP_FROM: "Hotel <mail@example.org>",
		HOTEL_NAME: "Hotel",
	},
}));
vi.mock("node:child_process", () => ({ exec: mocks.exec }));
vi.mock("node:fs/promises", () => ({
	writeFile: mocks.write,
	mkdir: mocks.mkdir,
}));
vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/lib/logger", () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("resend", () => ({
	Resend: class {
		emails = { send: mocks.api };
	},
}));

import { sendMail } from "./email";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.env.SMTP_FROM = "Hotel <mail@example.org>";
	mocks.exec.mockImplementation((_command, callback) => {
		callback(null);
		return { stdin: { write: vi.fn(), end: vi.fn() } };
	});
});
it.each([
	["recipient@example.org\r\nBcc: injected@example.org", "Hello"],
	["recipient@example.org", "Hello\nBcc: injected@example.org"],
	["recipient@example.org", "Hi\u0000bad"],
])(
	"rejects header injection before contacting any mail transport",
	async (to, subject) => {
		expect(await sendMail(to, subject, "<p>Test</p>")).toBe(false);
		expect(mocks.exec).not.toHaveBeenCalled();
		expect(mocks.api).not.toHaveBeenCalled();
		expect(mocks.write).not.toHaveBeenCalled();
	},
);
it("also rejects an unsafe configured sender", async () => {
	mocks.env.SMTP_FROM = "hotel@example.org\r\nBcc: injected@example.org";
	expect(await sendMail("user@example.org", "Hello", "<p>Test</p>")).toBe(
		false,
	);
	expect(mocks.exec).not.toHaveBeenCalled();
});
it("preserves legitimate unicode subjects and HTML body newlines", async () => {
	expect(
		await sendMail(
			"user@example.org",
			"Novità dell’hotel",
			"<p>Hi</p>\n<p>Welcome</p>",
		),
	).toBe(true);
	expect(mocks.exec).toHaveBeenCalledOnce();
});
