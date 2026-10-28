// @ts-nocheck
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyDeployedRelease } from "../../scripts/verify-deployed-release.mjs";

const sha = "a".repeat(40);
afterEach(() => vi.unstubAllGlobals());
describe("deployed HTTP release readiness", () => {
	it("waits through an old response and startup failure until the exact release is ready", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ database: true }))
			.mockRejectedValueOnce(new Error("connection refused"))
			.mockResolvedValueOnce(Response.json({ database: true, release: sha }));
		vi.stubGlobal("fetch", fetch);
		const report = vi.fn();
		await verifyDeployedRelease("http://localhost:3002/api/health", sha, {
			attempts: 3,
			interval: 0,
			report,
		});
		expect(fetch).toHaveBeenCalledTimes(3);
		expect(report).toHaveBeenCalledTimes(2);
		expect(JSON.parse(report.mock.calls[0][0]).observed.release).toBeNull();
	});
	it.each([
		[200, { database: true, release: "old" }],
		[200, { database: true }],
		[429, { status: "rate_limited" }],
		// The health route answers 503 with the correct release when the
		// database is unreachable, so this must never pass the gate.
		[503, { database: false, release: sha }],
		[200, { database: false, release: sha }],
	])(
		"rejects HTTP %s without the expected healthy release",
		async (status, body) => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(Response.json(body, { status })),
			);
			const report = vi.fn();
			await expect(
				verifyDeployedRelease("http://localhost:3002/api/health", sha, {
					attempts: 2,
					interval: 0,
					report,
				}),
			).rejects.toThrow("never became healthy");
			expect(report).toHaveBeenCalledTimes(2);
			expect(JSON.parse(report.mock.calls[0][0]).observed.http).toBe(status);
		},
	);
});
