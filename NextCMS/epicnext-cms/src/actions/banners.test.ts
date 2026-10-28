// @ts-nocheck
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	allowed: true,
	authenticated: true,
	existing: [] as { id: number }[],
	inserts: [] as { table: unknown; values: unknown }[],
	updates: [] as { table: unknown; values: unknown }[],
	deletes: [] as { table: unknown; where: unknown }[],
}));

const mockGetApiAdminContext = vi.hoisted(() => vi.fn());
const mockCanAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/permissions", async () => {
	const { PERMS } = await import("@/lib/permission-slugs");
	return {
		PERMS,
		getApiAdminContext: mockGetApiAdminContext,
		canAccess: mockCanAccess,
	};
});

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/admin/authorization-events", () => ({
	logAuthorizationEvent: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn() }));
const mockExtractClientIpAsync = vi.hoisted(() => vi.fn());
vi.mock("@/lib/foundation/security", () => ({
	extractClientIpAsync: mockExtractClientIpAsync,
}));

const mockLogAudit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/audit", () => ({ logAudit: mockLogAudit }));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
	unstable_cache: (fn: unknown) => fn,
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	return {
		...schema,
		db: {
			...createFakeDb((table) =>
				table === schema.WebsiteBanner ? state.existing : [],
			),
			insert: (table: unknown) => ({
				values: (values: unknown) => {
					state.inserts.push({ table, values });
					return [{ insertId: 5 }];
				},
			}),
			update: (table: unknown) => ({
				set: (values: unknown) => ({
					where: (where: unknown) => {
						state.updates.push({ table, values, where });
						return [{ affectedRows: 1 }];
					},
				}),
			}),
			delete: (table: unknown) => ({
				where: (where: unknown) => {
					state.deletes.push({ table, where });
					return [{ affectedRows: 1 }];
				},
			}),
		},
	};
});

import { WebsiteBanner } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { createBanner, deleteBanner, updateBanner } from "./banners";

function session() {
	return {
		session: { user: { id: 42, rank: 7, name: "admin" } },
		permissions: {},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	state.allowed = true;
	state.authenticated = true;
	state.existing = [];
	state.inserts = [];
	state.updates = [];
	state.deletes = [];
	mockGetApiAdminContext.mockReset();
	mockGetApiAdminContext.mockImplementation(async () =>
		state.authenticated ? session() : null,
	);
	mockCanAccess.mockImplementation(() => state.allowed);
	mockExtractClientIpAsync.mockResolvedValue("127.0.0.1");
	mockLogAudit.mockResolvedValue(undefined);
});

describe("createBanner", () => {
	it("creates a banner with schema defaults applied", async () => {
		const result = await createBanner({ title: "T", image: "img.png" });

		expect(result).toEqual({ ok: true, data: { id: 5 } });
		expect(state.inserts).toHaveLength(1);
		expect(state.inserts[0].table).toBe(WebsiteBanner);
		expect(state.inserts[0].values).toMatchObject({
			title: "T",
			subtitle: "",
			image: "img.png",
			link: "",
			color: "",
			isActive: 1,
			sortOrder: 0,
		});
		expect(mockLogAudit).toHaveBeenCalledWith({
			userId: 42,
			action: "banner_create",
			target: "WebsiteBanner",
			targetId: 5,
			after: { title: "T" },
		});
		expect(mockCanAccess).toHaveBeenCalledWith({}, PERMS.BANNERS_EDIT, 7);
	});

	it("allows explicit optional fields", async () => {
		await createBanner({
			title: "Sale",
			image: "sale.jpg",
			link: "https://example.com",
			color: "#fff",
			isActive: 0,
			sortOrder: 3,
			startDate: "2026-01-01",
			endDate: "2026-02-01",
			subtitle: "Big",
		});
		expect(state.inserts[0].values).toMatchObject({
			link: "https://example.com",
			color: "#fff",
			isActive: 0,
			sortOrder: 3,
			startDate: "2026-01-01",
			endDate: "2026-02-01",
			subtitle: "Big",
		});
	});

	it("denies when the caller lacks permission", async () => {
		state.allowed = false;
		const result = await createBanner({ title: "T", image: "i" });
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Unauthorized");
		expect(state.inserts).toHaveLength(0);
	});

	it("denies unauthenticated callers", async () => {
		state.authenticated = false;
		const result = await createBanner({ title: "T", image: "i" });
		expect(result).toEqual({ ok: false, error: "Unauthorized" });
	});

	it("rejects a missing title via validation", async () => {
		const result = await createBanner({ image: "i" });
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Validation failed");
		expect(
			(result as { fieldErrors: Record<string, string[]> }).fieldErrors.title,
		).toBeDefined();
	});

	it("rejects an out-of-range isActive value", async () => {
		const result = await createBanner({ title: "T", image: "i", isActive: 2 });
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Validation failed");
	});

	it("rejects an over-long image url", async () => {
		const result = await createBanner({
			title: "T",
			image: "i".repeat(501),
		});
		expect(result.ok).toBe(false);
		expect(
			(result as { fieldErrors: Record<string, string[]> }).fieldErrors.image,
		).toBeDefined();
	});
});

describe("updateBanner", () => {
	it("fails when the banner does not exist", async () => {
		state.existing = [];
		const result = await updateBanner({ id: 9, title: "X" });
		expect(result).toEqual({ ok: false, error: "Banner not found" });
		expect(state.updates).toHaveLength(0);
	});

	it("updates only the whitelisted fields and audits", async () => {
		state.existing = [{ id: 9 }];
		const result = await updateBanner({
			id: 9,
			title: "X",
			subtitle: "s",
			image: "x.png",
			link: "l",
			color: "c",
			isActive: 1,
			sortOrder: 2,
		});

		expect(result).toEqual({ ok: true, data: { id: 9 } });
		expect(state.updates).toHaveLength(1);
		expect(state.updates[0].table).toBe(WebsiteBanner);
		expect(state.updates[0].where).toEqual(eq(WebsiteBanner.id, 9));
		const values = state.updates[0].values as Record<string, unknown>;
		expect(values).not.toHaveProperty("id");
		expect(values.title).toBe("X");
		expect(mockLogAudit).toHaveBeenCalledWith({
			userId: 42,
			action: "banner_update",
			target: "WebsiteBanner",
			targetId: 9,
		});
	});

	it("rejects a non-positive id", async () => {
		state.existing = [{ id: 1 }];
		const result = await updateBanner({ id: 0, title: "X" });
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Validation failed");
	});
});

describe("deleteBanner", () => {
	it("deletes the banner and audits", async () => {
		const result = await deleteBanner({ id: 3 });
		expect(result).toEqual({ ok: true, data: {} });
		expect(state.deletes).toHaveLength(1);
		expect(state.deletes[0].table).toBe(WebsiteBanner);
		expect(state.deletes[0].where).toEqual(eq(WebsiteBanner.id, 3));
		expect(mockLogAudit).toHaveBeenCalledWith({
			userId: 42,
			action: "banner_delete",
			target: "WebsiteBanner",
			targetId: 3,
		});
	});

	it("rejects an invalid id", async () => {
		const result = await deleteBanner({ id: -1 });
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Validation failed");
	});
});
