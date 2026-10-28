import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockLimit })));
const mockFrom = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockFrom })));
const mockRedisGet = vi.hoisted(() => vi.fn());
const mockRedisSetex = vi.hoisted(() => vi.fn());
const mockRedisDel = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
	db: { select: mockSelect },
	User: { id: "id", websiteJwtVersion: "websiteJwtVersion" },
}));

vi.mock("@/lib/redis", () => ({
	redis: {
		get: mockRedisGet,
		setex: mockRedisSetex,
		del: mockRedisDel,
	},
}));

describe("jwt-version-cache", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockWhere.mockReturnValue({ limit: mockLimit });
		mockFrom.mockReturnValue({ where: mockWhere });
		mockSelect.mockReturnValue({ from: mockFrom });
		mockRedisGet.mockResolvedValue(null);
		mockRedisSetex.mockResolvedValue("OK");
		mockRedisDel.mockResolvedValue(1);
	});

	it("returns DB version and caches it", async () => {
		mockLimit.mockResolvedValue([{ websiteJwtVersion: 3 }]);
		const { getCachedJwtVersion } = await import("./jwt-version-cache");
		await expect(getCachedJwtVersion(42)).resolves.toBe(3);
		expect(mockSelect).toHaveBeenCalledTimes(1);
		await expect(getCachedJwtVersion(42)).resolves.toBe(3);
		expect(mockSelect).toHaveBeenCalledTimes(1);
	});

	it("invalidates memory and redis entries", async () => {
		mockLimit.mockResolvedValue([{ websiteJwtVersion: 1 }]);
		const { getCachedJwtVersion, invalidateJwtVersionCache } = await import(
			"./jwt-version-cache"
		);
		await getCachedJwtVersion(7);
		await invalidateJwtVersionCache(7);
		expect(mockRedisDel).toHaveBeenCalled();
		mockLimit.mockResolvedValue([{ websiteJwtVersion: 2 }]);
		await expect(getCachedJwtVersion(7)).resolves.toBe(2);
	});
});
