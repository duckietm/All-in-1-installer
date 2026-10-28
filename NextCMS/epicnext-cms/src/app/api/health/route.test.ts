import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	clientIp: vi.fn(async () => "203.0.113.7"),
	rateLimit: vi.fn(
		async (): Promise<{ ok: boolean; retryAfter: number }> => ({
			ok: true,
			retryAfter: 0,
		}),
	),
	dbExecute: vi.fn(async () => [{}]),
	ping: vi.fn(async () => "PONG"),
	rconSend: vi.fn(async () => true),
}));
vi.mock("@/lib/rate-limit", () => ({
	clientIp: mocks.clientIp,
	rateLimit: mocks.rateLimit,
}));
vi.mock("@/lib/db", () => ({
	db: { execute: mocks.dbExecute },
}));
vi.mock("@/lib/redis", () => ({
	redis: {
		ping: mocks.ping,
	},
}));
vi.mock("@/lib/services/rcon", () => ({
	rcon: { send: mocks.rconSend },
}));
vi.mock("@/env", () => ({
	env: { REDIS_URL: "redis://cache.test:6379", RESEND_API_KEY: "" },
}));

import { GET } from "./route";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.ping.mockResolvedValue("PONG");
	mocks.dbExecute.mockResolvedValue([{}]);
	mocks.rconSend.mockResolvedValue(true);
	mocks.rateLimit.mockResolvedValue({ ok: true, retryAfter: 0 });
});

describe("ops health status", () => {
	it("answers 200 when the database is reachable", async () => {
		const res = await GET();
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			status: "ok",
			database: true,
		});
	});

	// The regression this guards: the route used to answer 200 unconditionally,
	// so the Docker healthcheck reported a container healthy while every page
	// failed to render.
	it("answers 503 when the database is unreachable", async () => {
		mocks.dbExecute.mockRejectedValue(new Error("ECONNREFUSED"));
		const res = await GET();
		expect(res.status).toBe(503);
		expect(await res.json()).toMatchObject({
			status: "degraded",
			database: false,
		});
	});

	// Redis and the emulator both have in-process fallbacks (cache.ts,
	// rate-limit.ts), so failing the container on them would turn a degraded
	// site into a restart loop.
	it("stays 200 on a Redis outage because the cache falls back in-process", async () => {
		mocks.ping.mockRejectedValue(new Error("ECONNREFUSED"));
		const res = await GET();
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			status: "degraded",
			database: true,
			redis: false,
		});
	});

	it("stays 200 when the emulator is unreachable", async () => {
		mocks.rconSend.mockResolvedValue(false);
		const res = await GET();
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ emulator: false });
	});

	it("still rate-limits before probing anything", async () => {
		mocks.rateLimit.mockResolvedValue({ ok: false, retryAfter: 30 });
		const res = await GET();
		expect(res.status).toBe(429);
		expect(res.headers.get("Retry-After")).toBe("30");
		expect(mocks.dbExecute).not.toHaveBeenCalled();
	});
});
