// @ts-nocheck
import { expect, it } from "vitest";
import { ADMIN_NAV_GROUPS } from "@/lib/admin-nav";
import { visibleAdminNavigation } from "./admin-navigation";

const access = { isSuperAdmin: true, allowedPermissions: [], navConfig: {} };
it("retains each route and its permission definition once after regrouping", () => {
	const original = ADMIN_NAV_GROUPS.flatMap((g) => g.items);
	const actual = visibleAdminNavigation(access).flatMap((g) => g.items);
	expect(actual).toHaveLength(original.length);
	expect(new Set(actual.map((i) => i.href)).size).toBe(actual.length);
	for (const item of original) expect(actual).toContain(item);
	expect(
		visibleAdminNavigation(access)
			.find((g) => g.labelKey === "catalogFurniture")
			?.items.some((i) => i.href === "/admin/studio"),
	).toBe(true);
});
it("respects hidden groups, owner order and ACL in every consumer", () => {
	const configured = visibleAdminNavigation({
		...access,
		navConfig: {
			groupOrder: ["monitoring"],
			hiddenGroups: ["economy"],
			hiddenItems: ["/admin/studio"],
		},
	});
	expect(configured[0].labelKey).toBe("monitoring");
	expect(
		configured
			.flatMap((g) => g.items)
			.some((i) => i.href === "/admin/studio" || i.href === "/admin/catalog"),
	).toBe(false);
	const limited = visibleAdminNavigation({
		...access,
		isSuperAdmin: false,
	}).flatMap((g) => g.items);
	expect(limited.every((i) => !i.permission)).toBe(true);
});
