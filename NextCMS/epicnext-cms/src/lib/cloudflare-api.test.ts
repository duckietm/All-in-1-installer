import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	cloudflareEnabled,
	getCloudflareApiConfig,
	listCloudflareBlocks,
	maybeAutoBlockCloudflare,
	removeCloudflareBlock,
	resetCloudflareAutoBlockCache,
	sweepExpiredCloudflareBlocks,
	verifyCloudflareConnection,
} from "./cloudflare-api";

// The coordination state must be deterministic in CI too (where REDIS_URL is
// set), so the unit test drives a small in-memory Redis fake.
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

function envForRealSetup(): void {
	vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-api-token");
	vi.stubEnv("CLOUDFLARE_ZONE_ID", "z123");
}

describe("cloudflare-api", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		state.map.clear();
		resetCloudflareAutoBlockCache();
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		state.map.clear();
		resetCloudflareAutoBlockCache();
	});

	it("is configured only when a token and a zone id are present", () => {
		vi.stubEnv("CLOUDFLARE_API_TOKEN", "tok");
		expect(cloudflareEnabled()).toBe(false);
		vi.stubEnv("CLOUDFLARE_ZONE_ID", "z1");
		expect(cloudflareEnabled()).toBe(true);
		const config = getCloudflareApiConfig();
		expect(config.token).toBe("tok");
		expect(config.zoneId).toBe("z1");
		expect(config.baseUrl).toBe("https://api.cloudflare.com/client/v4");
	});

	it("reports a missing credential without calling the API", async () => {
		const status = await verifyCloudflareConnection();
		expect(status.ok).toBe(false);
		expect(status.message).toContain("CLOUDFLARE_API_TOKEN");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("verifies the zone when the token is valid", async () => {
		envForRealSetup();
		fetchMock.mockResolvedValue(
			jsonResponse({
				success: true,
				errors: [],
				result: { id: "z123", name: "example.com" },
			}),
		);

		const status = await verifyCloudflareConnection();
		expect(status.ok).toBe(true);
		expect(status.zoneName).toBe("example.com");
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const [url, init] = fetchMock.mock.calls[0];
		expect(String(url)).toContain("/zones/z123");
		expect(init.headers.Authorization).toBe("Bearer test-api-token");
	});

	it("surfaces a rejected credential", async () => {
		envForRealSetup();
		fetchMock.mockResolvedValue(
			jsonResponse(
				{
					success: false,
					errors: [{ code: 10000, message: "Invalid token" }],
					result: null,
				},
				403,
			),
		);

		const status = await verifyCloudflareConnection();
		expect(status.ok).toBe(false);
		expect(status.message).toContain("Invalid token");
	});

	it("creates an IP Access Rule for a blocked client", async () => {
		envForRealSetup();
		fetchMock.mockResolvedValue(
			jsonResponse({ success: true, errors: [], result: { id: "rule1" } }),
		);

		await maybeAutoBlockCloudflare({
			ip: "192.0.2.55",
			ttlSeconds: 600,
			category: "api",
			enabled: true,
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(String(url)).toContain("/zones/z123/firewall/access_rules/rules");
		expect(init.method).toBe("POST");
		const body = JSON.parse(init.body as string);
		expect(body.mode).toBe("block");
		expect(body.configuration).toEqual({ target: "ip", value: "192.0.2.55" });
		expect(body.notes).toContain("category=api");
		expect(body.notes).toContain("ttl=600s");
	});

	it("supports IPv6 client addresses", async () => {
		envForRealSetup();
		fetchMock.mockResolvedValue(
			jsonResponse({ success: true, errors: [], result: { id: "rule6" } }),
		);

		await maybeAutoBlockCloudflare({
			ip: "2001:db8::5",
			ttlSeconds: 3600,
			category: "auth",
			enabled: true,
		});

		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.configuration.value).toBe("2001:db8::5");
	});

	it("dedupes until the block expires", async () => {
		envForRealSetup();
		fetchMock.mockResolvedValue(
			jsonResponse({ success: true, errors: [], result: { id: "rule1" } }),
		);

		for (let i = 0; i < 3; i += 1) {
			await maybeAutoBlockCloudflare({
				ip: "198.51.100.1",
				ttlSeconds: 600,
				category: "api",
				enabled: true,
			});
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does nothing when the runtime toggle is off", async () => {
		envForRealSetup();
		await maybeAutoBlockCloudflare({
			ip: "198.51.100.2",
			ttlSeconds: 600,
			category: "api",
			enabled: false,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("does nothing without credentials", async () => {
		await maybeAutoBlockCloudflare({
			ip: "198.51.100.3",
			ttlSeconds: 600,
			category: "api",
			enabled: true,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("never auto-blocks the unknown-IP sentinel", async () => {
		envForRealSetup();
		await maybeAutoBlockCloudflare({
			ip: "0.0.0.0",
			ttlSeconds: 600,
			category: "api",
			enabled: true,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("swallows API failures instead of throwing on the hot path", async () => {
		envForRealSetup();
		fetchMock.mockResolvedValue(
			jsonResponse(
				{
					success: false,
					errors: [{ code: 9109, message: "Not enough quota" }],
					result: null,
				},
				400,
			),
		);

		await expect(
			maybeAutoBlockCloudflare({
				ip: "198.51.100.4",
				ttlSeconds: 600,
				category: "api",
				enabled: true,
			}),
		).resolves.toBeUndefined();
	});

	it("sweeps expired blocks and deletes their edge rules", async () => {
		envForRealSetup();
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse({ success: true, errors: [], result: { id: "rule-x" } }),
			)
			.mockResolvedValueOnce(
				jsonResponse({ success: true, errors: [], result: {} }),
			);

		await maybeAutoBlockCloudflare({
			ip: "198.51.100.9",
			ttlSeconds: 1,
			category: "auth",
			enabled: true,
		});
		await new Promise((resolve) => setTimeout(resolve, 1_100));

		const removed = await sweepExpiredCloudflareBlocks();
		expect(removed).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(String(fetchMock.mock.calls[1][0])).toContain(
			"/firewall/access_rules/rules/rule-x",
		);
		expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
		expect(await listCloudflareBlocks()).toHaveLength(0);
	});

	it("lists active blocks closest to expiry first", async () => {
		envForRealSetup();
		fetchMock.mockResolvedValue(
			jsonResponse({ success: true, errors: [], result: { id: "rule1" } }),
		);

		await maybeAutoBlockCloudflare({
			ip: "198.51.100.7",
			ttlSeconds: 600,
			category: "api",
			enabled: true,
		});
		const blocks = await listCloudflareBlocks();
		expect(blocks).toHaveLength(1);
		expect(blocks[0].ip).toBe("198.51.100.7");
		expect(blocks[0].remainingSeconds).toBeGreaterThan(0);
		expect(blocks[0].expired).toBe(false);
	});

	it("removes a tracked block through the admin action", async () => {
		envForRealSetup();
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse({ success: true, errors: [], result: { id: "rule-y" } }),
			)
			.mockResolvedValueOnce(
				jsonResponse({ success: true, errors: [], result: {} }),
			);

		await maybeAutoBlockCloudflare({
			ip: "198.51.100.8",
			ttlSeconds: 600,
			category: "pages",
			enabled: true,
		});
		const first = await removeCloudflareBlock("198.51.100.8");
		expect(first.removed).toBe(true);
		expect(String(fetchMock.mock.calls[1][0])).toContain("/rules/rule-y");

		const second = await removeCloudflareBlock("198.51.100.8");
		expect(second.removed).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("keeps local tracking when the Cloudflare delete fails", async () => {
		envForRealSetup();
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse({ success: true, errors: [], result: { id: "rule-z" } }),
			)
			.mockResolvedValueOnce(
				jsonResponse(
					{
						success: false,
						errors: [{ code: 6003, message: "boom" }],
						result: null,
					},
					400,
				),
			);

		await maybeAutoBlockCloudflare({
			ip: "198.51.100.6",
			ttlSeconds: 600,
			category: "api",
			enabled: true,
		});
		const result = await removeCloudflareBlock("198.51.100.6");
		expect(result.removed).toBe(false);
		expect(result.message).toContain("boom");
		expect(await listCloudflareBlocks()).toHaveLength(1);
	});
});
