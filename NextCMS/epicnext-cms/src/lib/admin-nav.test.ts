// @ts-nocheck
import { Calendar } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
	ADMIN_NAV_GROUPS,
	collectNavPermissionSlugs,
	findAdminHub,
	navItemIsAllowed,
} from "./admin-nav";

describe("findAdminHub", () => {
	it("matches by prefix", () => {
		expect(findAdminHub("/admin/events")?.id).toBe("events");
		expect(findAdminHub("/admin/events/123")?.id).toBe("events");
	});
	it("uses longest-prefix match", () => {
		expect(findAdminHub("/admin/tickets/desk")?.id).toBe("tickets");
	});
	it("returns null for non-hub paths", () => {
		expect(findAdminHub("/admin/users")).toBeNull();
		expect(findAdminHub("/login")).toBeNull();
	});
});

describe("navItemIsAllowed", () => {
	const item = {
		href: "/admin/x",
		labelKey: "x",
		icon: Calendar,
		permission: "a.view",
	};

	it("always allows for super admins", () => {
		expect(
			navItemIsAllowed(item, { isSuperAdmin: true, has: () => false }),
		).toBe(true);
	});
	it("allows when any needed slug is granted", () => {
		expect(
			navItemIsAllowed(item, {
				isSuperAdmin: false,
				has: (s) => s === "a.view",
			}),
		).toBe(true);
	});
	it("denies when no slug is granted", () => {
		expect(
			navItemIsAllowed(item, { isSuperAdmin: false, has: () => false }),
		).toBe(false);
	});
	it("allows items without a permission requirement", () => {
		expect(
			navItemIsAllowed(
				{ href: "/admin/d", labelKey: "d", icon: Calendar },
				{ isSuperAdmin: false, has: () => false },
			),
		).toBe(true);
	});
	it("supports an array of permissions (any match)", () => {
		const multi = {
			href: "/admin/m",
			labelKey: "m",
			icon: Calendar,
			permission: ["x.view", "y.view"],
		};
		expect(
			navItemIsAllowed(multi, {
				isSuperAdmin: false,
				has: (s) => s === "y.view",
			}),
		).toBe(true);
	});
});

describe("collectNavPermissionSlugs", () => {
	it("returns unique slugs referenced by the sidebar", () => {
		const slugs = collectNavPermissionSlugs();
		expect(new Set(slugs).size).toBe(slugs.length);
		expect(slugs.length).toBeGreaterThan(0);
	});
	it("is consistent with the nav groups", () => {
		const groupSlugs = new Set<string>();
		for (const group of ADMIN_NAV_GROUPS) {
			for (const item of group.items) {
				if (!item.permission) continue;
				const needed = Array.isArray(item.permission)
					? item.permission
					: [item.permission];
				for (const s of needed) groupSlugs.add(s);
			}
		}
		expect([...groupSlugs]).toEqual(collectNavPermissionSlugs());
	});
});
