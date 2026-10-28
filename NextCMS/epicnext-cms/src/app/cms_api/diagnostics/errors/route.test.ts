import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ append: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
	clientIp: async () => "test",
	rateLimit: mocks.limit,
}));
vi.mock("@/lib/error-monitor", async () => {
	const actual = await vi.importActual<typeof import("@/lib/error-monitor")>(
		"@/lib/error-monitor",
	);
	return {
		...actual,
		ErrorStore: class {
			append = mocks.append;
		},
	};
});

import { POST } from "./route";

afterEach(() => vi.resetAllMocks());
const req = (body: string, origin = "https://cms.test") =>
	new Request("https://cms.test/cms_api/diagnostics/errors", {
		method: "POST",
		headers: { origin, "Content-Type": "application/json" },
		body,
	});
it("rejects cross-origin reports before touching storage", async () => {
	expect((await POST(req("{}", "https://other.test"))).status).toBe(403);
	expect(mocks.append).not.toHaveBeenCalled();
});
it("limits reports before reading their body", async () => {
	mocks.limit.mockResolvedValue({ ok: false });
	expect((await POST(req("{}"))).status).toBe(429);
	expect(mocks.append).not.toHaveBeenCalled();
});
it("rejects oversized reports without trusting content-length", async () => {
	mocks.limit.mockResolvedValue({ ok: true });
	expect((await POST(req("a".repeat(17000)))).status).toBe(413);
	expect(mocks.append).not.toHaveBeenCalled();
});
it("stores only sanitized diagnostic fields and identifies browser claims", async () => {
	mocks.limit.mockResolvedValue({ ok: true });
	mocks.append.mockResolvedValue(undefined);
	const r = await POST(
		req(
			JSON.stringify({
				event: "browser.exception",
				message: "token=secret",
				path: "/news?token=hidden",
				body: "never store",
				release: "old-client",
			}),
		),
	);
	expect(r.status).toBe(202);
	const saved = mocks.append.mock.calls[0][0];
	expect(saved.source).toBe("browser");
	expect(saved.context.clientRelease).toBe("old-client");
	expect(JSON.stringify(saved)).not.toMatch(/hidden|never store|token=secret/);
});
it("reports storage failure rather than claiming receipt", async () => {
	mocks.limit.mockResolvedValue({ ok: true });
	mocks.append.mockRejectedValue(new Error("disk"));
	expect(
		(
			await POST(
				req(
					JSON.stringify({
						event: "browser.exception",
						message: "failure",
						path: "/",
					}),
				),
			)
		).status,
	).toBe(503);
});
