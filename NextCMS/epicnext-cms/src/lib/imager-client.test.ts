// @ts-nocheck
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalHotelName = process.env.HOTEL_NAME;
const originalSkipValidation = process.env.SKIP_ENV_VALIDATION;

afterEach(() => {
	vi.resetModules();
	if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = originalDatabaseUrl;
	if (originalHotelName === undefined) delete process.env.HOTEL_NAME;
	else process.env.HOTEL_NAME = originalHotelName;
	if (originalSkipValidation === undefined)
		delete process.env.SKIP_ENV_VALIDATION;
	else process.env.SKIP_ENV_VALIDATION = originalSkipValidation;
});

describe("imager client boundary", () => {
	it("loads without server-only environment variables", async () => {
		delete process.env.DATABASE_URL;
		delete process.env.HOTEL_NAME;
		vi.resetModules();
		delete process.env.SKIP_ENV_VALIDATION;

		const imager = await import("./imager");

		expect(imager.getAvatarUrl("hd-180-1")).toContain("figure=hd-180-1");
	});
});
