// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const set = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));

import { setLocaleCookie } from "./set-locale";

beforeEach(() => vi.clearAllMocks());
it.each(["../../private", "xx", "en\r\nSet-Cookie:bad=1", "", "EN", null, 42])(
	"rejects an unsupported locale without writing cookies: %s",
	async (value) => {
		await setLocaleCookie(value as string);
		expect(set).not.toHaveBeenCalled();
	},
);
it.each(["en", "it", "nl"])("keeps supported locale %s", async (value) => {
	await setLocaleCookie(value);
	expect(set).toHaveBeenCalledWith(
		"NEXT_LOCALE",
		value,
		expect.objectContaining({ sameSite: "strict", secure: true }),
	);
});
