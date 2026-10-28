// @ts-nocheck
import { LayoutDashboard, Newspaper, Settings } from "lucide-react";
import { describe, expect, it } from "vitest";
import type { AdminNavGroup } from "@/lib/admin-nav";
import {
	ADMIN_NAV_PINNED_HREFS,
	applyAdminNavConfig,
	parseAdminNavConfig,
	serializeAdminNavConfig,
} from "@/lib/admin-nav-config";

const catalog: AdminNavGroup[] = [
	{
		labelKey: "overview",
		icon: LayoutDashboard,
		items: [
			{ href: "/admin", labelKey: "dashboard", icon: LayoutDashboard },
			{ href: "/admin/menu", labelKey: "menu", icon: Settings },
		],
	},
	{
		labelKey: "content",
		icon: Newspaper,
		items: [
			{ href: "/admin/articles", labelKey: "articles", icon: Newspaper },
			{ href: "/admin/photos", labelKey: "photos", icon: Newspaper },
		],
	},
	{
		labelKey: "system",
		icon: Settings,
		items: [{ href: "/admin/settings", labelKey: "settings", icon: Settings }],
	},
];

describe("admin-nav-config", () => {
	it("parses empty / invalid as empty config", () => {
		expect(parseAdminNavConfig(null)).toEqual({});
		expect(parseAdminNavConfig("")).toEqual({});
		expect(parseAdminNavConfig("not-json")).toEqual({});
		expect(parseAdminNavConfig("[]")).toEqual({});
	});

	it("reorders groups and items", () => {
		const applied = applyAdminNavConfig(catalog, {
			groupOrder: ["system", "content", "overview"],
			itemOrder: {
				content: ["/admin/photos", "/admin/articles"],
			},
		});
		expect(applied.map((g) => g.labelKey)).toEqual([
			"system",
			"content",
			"overview",
		]);
		expect(applied[1]?.items.map((i) => i.href)).toEqual([
			"/admin/photos",
			"/admin/articles",
		]);
	});

	it("hides groups and items but keeps pinned hrefs", () => {
		const applied = applyAdminNavConfig(catalog, {
			hiddenGroups: ["system"],
			hiddenItems: ["/admin/photos", "/admin", "/admin/menu"],
		});
		expect(applied.map((g) => g.labelKey)).toEqual(["overview", "content"]);
		expect(applied[0]?.items.map((i) => i.href)).toEqual(["/admin"]);
		expect(applied[1]?.items.map((i) => i.href)).toEqual(["/admin/articles"]);
		expect(ADMIN_NAV_PINNED_HREFS.has("/admin")).toBe(true);
	});

	it("round-trips serialize → parse", () => {
		const raw = serializeAdminNavConfig({
			groupOrder: ["content"],
			hiddenGroups: ["system"],
			hiddenItems: ["/admin/photos", "/admin"],
			itemOrder: { content: ["/admin/articles"] },
		});
		const parsed = parseAdminNavConfig(raw);
		expect(parsed.groupOrder).toEqual(["content"]);
		expect(parsed.hiddenGroups).toEqual(["system"]);
		expect(parsed.hiddenItems).toEqual(["/admin/photos"]);
		expect(parsed.itemOrder).toEqual({ content: ["/admin/articles"] });
	});
});
