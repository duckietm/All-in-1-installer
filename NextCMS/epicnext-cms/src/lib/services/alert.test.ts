// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const insertValues = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
	db: {
		insert: vi.fn(() => ({ values: insertValues })),
	},
	AlertLogs: {},
}));

vi.mock("@/lib/services/email", () => ({
	sendMail: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/env", () => ({
	env: {
		DISCORD_WEBHOOK_URL: "",
		ALERT_EMAIL: "",
		HOTEL_NAME: "TestHotel",
		APP_URL: "http://localhost:3000",
		NODE_ENV: "test",
	},
}));

import { sendMail } from "@/lib/services/email";
import { diskPressure, sendAlert } from "./alert";

beforeEach(() => {
	insertValues.mockReset();
	vi.mocked(sendMail).mockReset();
	vi.mocked(sendMail).mockResolvedValue(true);
	insertValues.mockResolvedValue([{ insertId: 1 }]);
});

describe("sendAlert", () => {
	it("persists an alert log entry", async () => {
		await sendAlert({
			type: "test",
			severity: "warning",
			message: "test alert",
		});
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "test",
				severity: "warning",
				message: "test alert",
				isRead: false,
			}),
		);
	});

	it("returns logged=true when DB write succeeds", async () => {
		const result = await sendAlert({
			type: "test",
			severity: "info",
			message: "ok",
		});
		expect(result.logged).toBe(true);
	});

	it("does not call sendMail when ALERT_EMAIL is unset", async () => {
		await sendAlert({ type: "test", severity: "error", message: "m" });
		expect(sendMail).not.toHaveBeenCalled();
	});
});

describe("diskPressure", () => {
	const usage = (percent: number) => ({
		filesystem: "/dev/vda1",
		mount: "/",
		totalBytes: 100000000000,
		usedBytes: (percent / 100) * 100000000000,
		availableBytes: 100000000000 - (percent / 100) * 100000000000,
		percent,
	});

	it("raises a warning at 87% fill", async () => {
		await diskPressure(usage(87));
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "disk",
				severity: "warning",
			}),
		);
	});

	it("raises an error at 92% fill", async () => {
		await diskPressure(usage(92));
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "disk",
				severity: "error",
			}),
		);
	});

	it("raises a critical alert at 96% fill", async () => {
		await diskPressure(usage(96));
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "disk",
				severity: "critical",
				context: expect.stringContaining('"mount":"/"'),
			}),
		);
	});
});
