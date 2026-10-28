// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
	status: "ready",
	exec: vi.fn(),
	lrange: vi.fn(),
}));
vi.mock("@/lib/redis", () => ({
	redis: {
		get status() {
			return mock.status;
		},
		multi() {
			const chain = {
				lpush: () => chain,
				ltrim: () => chain,
				expire: () => chain,
				exec: mock.exec,
			};
			return chain;
		},
		lrange: mock.lrange,
	},
}));

import { readPerformance, recordPerformance } from "./performance-store";

const sample = {
	operationId: "op",
	route: "/api/admin/test",
	method: "GET",
	status: 200,
	at: Date.now(),
	streaming: false,
	metrics: {
		durationMs: 1200,
		database: { count: 2, durationMs: 1000, errors: 0 },
		external: { count: 0, durationMs: 0, errors: 0 },
	},
};
beforeEach(() => {
	mock.status = "ready";
	mock.exec.mockResolvedValue([]);
	mock.lrange.mockResolvedValue([]);
});
it("does not fail a request when storage rejects writes", async () => {
	mock.exec.mockRejectedValue(new Error("offline"));
	expect(() => recordPerformance(sample)).not.toThrow();
	await Promise.resolve();
	await Promise.resolve();
});
it("falls back to bounded local samples when Redis is unavailable", async () => {
	mock.status = "end";
	for (let n = 0; n < 250; n++)
		recordPerformance({ ...sample, operationId: String(n) });
	const result = await readPerformance();
	expect(result.shared).toBe(false);
	expect(result.samples).toHaveLength(200);
	expect(result.samples[0].operationId).toBe("249");
});
it("ignores expired and malformed shared records", async () => {
	mock.lrange.mockResolvedValue([
		"bad",
		JSON.stringify({ ...sample, at: 1 }),
		JSON.stringify(sample),
	]);
	const result = await readPerformance();
	expect(result.shared).toBe(true);
	expect(result.samples).toEqual([sample]);
});

it("keeps public traffic separate from retained HK operations", async () => {
	mock.status = "end";
	recordPerformance({ ...sample, operationId: "hk-retained" });
	for (let n = 0; n < 230; n++)
		recordPerformance({
			...sample,
			kind: "public-page",
			outcome: "completed",
			operationId: `public-${n}`,
		});
	const admin = await readPerformance();
	const publicPages = await readPerformance("public-page");
	expect(admin.samples[0].operationId).toBe("hk-retained");
	expect(publicPages.samples).toHaveLength(200);
	expect(publicPages.samples[0].operationId).toBe("public-229");
});
