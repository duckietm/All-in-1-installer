// @ts-nocheck
import { afterEach, expect, it, vi } from "vitest";
import { reportBrowserError } from "./browser-errors";

afterEach(() => vi.unstubAllGlobals());
it("returns a reusable reference, deduplicates reports and omits URL parameters", () => {
	const fetchMock = vi.fn().mockResolvedValue({ ok: true });
	vi.stubGlobal("window", {});
	vi.stubGlobal("location", {
		pathname: "/admin/studio",
		search: "?token=secret",
	});
	vi.stubGlobal("fetch", fetchMock);
	const error = new Error("browser-test-unique");
	const id = reportBrowserError(error);
	expect(reportBrowserError(error)).toBe(id);
	expect(fetchMock).toHaveBeenCalledTimes(1);
	const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
	expect(payload.clientReference).toBe(id);
	expect(payload.path).toBe("/admin/studio");
	expect(JSON.stringify(payload)).not.toContain("token=secret");
});
it("never throws again when reporting fails on the network", async () => {
	vi.stubGlobal("window", {});
	vi.stubGlobal("location", { pathname: "/" });
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
	expect(reportBrowserError(new Error("offline-test"))).toBeTruthy();
	await Promise.resolve();
});
