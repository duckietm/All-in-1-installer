import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateAntiddosConfig } from "@/lib/antiddos-config";
import { resetCloudflareAutoBlockCache } from "@/lib/cloudflare-api";
import { enforceDdosRateLimit } from "@/lib/ddos-guard";

// The gate's block escalation (and thus the auto-block hook) only runs when
// Redis is reachable, so the integration test drives a small in-memory fake.
const state = vi.hoisted(() => ({ map: new Map<string, string>() }));

vi.mock("@/lib/redis", () => ({
	redis: {
		get: async (key: string) => state.map.get(key) ?? null,
		set: async (
			key: string,
			value: string,
			_mode?: string,
			_seconds?: number,
			nx?: string,
		) => {
			if (nx === "NX" && state.map.has(key)) return null;
			state.map.set(key, value);
			return "OK";
		},
		del: async (...keys: string[]) => {
			for (const key of keys) state.map.delete(key);
			return keys.length;
		},
		incr: async (key: string) => {
			const next = (Number(state.map.get(key)) || 0) + 1;
			state.map.set(key, String(next));
			return next;
		},
		pexpire: async () => 1,
		pttl: async () => 60_000,
		sadd: async (key: string, member: string) => {
			const members = new Set(
				(state.map.get(key) ?? "").split("\u0001").filter(Boolean),
			);
			members.add(member);
			state.map.set(key, [...members].join("\u0001"));
			return 1;
		},
		srem: async (key: string, member: string) => {
			const members = new Set(
				(state.map.get(key) ?? "").split("\u0001").filter(Boolean),
			);
			const before = members.size;
			members.delete(member);
			state.map.set(key, [...members].join("\u0001"));
			return before - members.size;
		},
		smembers: async (key: string) =>
			(state.map.get(key) ?? "").split("\u0001").filter(Boolean),
	},
	__esModule: true,
}));

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function proxiedRequest(ip: string): NextRequest {
	return new NextRequest("https://hotel.test/api/balance", {
		headers: { "cf-ray": "abc-AMS", "cf-connecting-ip": ip },
	});
}

function directRequest(ip: string): NextRequest {
	return new NextRequest("https://hotel.test/api/balance", {
		headers: { "x-real-ip": ip },
	});
}

async function pump(req: NextRequest, calls: number): Promise<number> {
	let blocks = 0;
	for (let i = 0; i < calls; i += 1) {
		const decision = await enforceDdosRateLimit(req);
		if (decision.outcome === "block") blocks += 1;
	}
	return blocks;
}

const apiLimit = "3";
const maxViolations = "2";

describe("anti-DDoS automatic Cloudflare blocks", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		state.map.clear();
		resetCloudflareAutoBlockCache();
		invalidateAntiddosConfig();
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("ANTI_DDOS_ENABLED", "true");
		vi.stubEnv("ANTI_DDOS_API_LIMIT", apiLimit);
		vi.stubEnv("ANTI_DDOS_MAX_VIOLATIONS", maxViolations);
		vi.stubEnv("ANTI_DDOS_VIOLATION_WINDOW_SEC", "60");
		vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-api-token");
		vi.stubEnv("CLOUDFLARE_ZONE_ID", "z123");
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		state.map.clear();
		resetCloudflareAutoBlockCache();
		invalidateAntiddosConfig();
	});

	it("creates an edge block for a proxied offender at the block threshold", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ success: true, errors: [], result: { id: "rule-a" } }),
		);

		const ip = "198.51.100.77";
		const blocks = await pump(proxiedRequest(ip), 5);
		expect(blocks).toBe(2);

		// Post-fire-and-forget settles before asserting.
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.configuration.value).toBe(ip);
		expect(body.notes).toContain("category=api");
	});

	it("does not re-create the edge block on subsequent hits", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ success: true, errors: [], result: { id: "rule-b" } }),
		);

		const ip = "198.51.100.78";
		await pump(proxiedRequest(ip), 12);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("never auto-blocks traffic that did not transit Cloudflare", async () => {
		await pump(directRequest("198.51.100.79"), 5);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("respects the runtime auto-block toggle from the config", async () => {
		vi.stubEnv("CLOUDFLARE_AUTO_BLOCK_ENABLED", "false");
		invalidateAntiddosConfig();

		await pump(proxiedRequest("198.51.100.80"), 5);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("stays silent when the Cloudflare credentials are not configured", async () => {
		vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
		vi.stubEnv("CLOUDFLARE_ZONE_ID", "");

		await pump(proxiedRequest("198.51.100.81"), 5);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("keeps gate decisions unchanged when the Cloudflare API fails", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				{
					success: false,
					errors: [{ code: 9109, message: "quota" }],
					result: null,
				},
				400,
			),
		);

		const ip = "198.51.100.82";
		const blocks = await pump(proxiedRequest(ip), 5);
		expect(blocks).toBe(2);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
