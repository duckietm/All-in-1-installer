import { describe, expect, it, vi } from "vitest";
import { PERMS } from "@/lib/permission-slugs";
import { HOUSEKEEPING_MANIFESTS } from "../manifests";
import { anyCapability, type HousekeepingCapabilityContext } from "./contracts";
import { buildHousekeepingNavigation } from "./navigation";
import { createHousekeepingRegistry } from "./registry";

const context = (
	granted: readonly string[],
): HousekeepingCapabilityContext => ({
	actor: { id: 42, username: "moderator", rank: 3 },
	isSuperAdmin: false,
	has: (slug) => granted.includes(slug),
	hasAny: (...slugs) => slugs.some((slug) => granted.includes(slug)),
	hasAll: (...slugs) => slugs.every((slug) => granted.includes(slug)),
});

describe("housekeeping navigation", () => {
	it("shows People to a moderator with a mod view capability while hiding Economy", () => {
		const registry = createHousekeepingRegistry([
			{
				id: "people",
				labelKey: "pages.housekeeping.domains.people.title",
				descriptionKey: "pages.housekeeping.domains.people.description",
				iconId: "users",
				previewHref: "/admin-next/people",
				capability: anyCapability(PERMS.MOD_CFH_VIEW),
				routes: [],
				searchProviders: [],
				inboxSources: [],
				widgets: [],
			},
			{
				id: "economy",
				labelKey: "pages.housekeeping.domains.economy.title",
				descriptionKey: "pages.housekeeping.domains.economy.description",
				iconId: "gem",
				previewHref: "/admin-next/economy",
				capability: anyCapability(PERMS.CATALOG_VIEW),
				routes: [],
				searchProviders: [],
				inboxSources: [],
				widgets: [],
			},
		]);

		const navigation = buildHousekeepingNavigation(
			registry,
			context([PERMS.MOD_CFH_VIEW]),
			(key) => key,
		);

		expect(navigation).toEqual([
			{
				id: "people",
				href: "/admin-next/people",
				iconId: "users",
				label: "pages.housekeeping.domains.people.title",
				description: "pages.housekeeping.domains.people.description",
				items: [],
			},
		]);
	});

	it("filters unauthorized domains and routes before translation", () => {
		const registry = createHousekeepingRegistry([
			{
				id: "people",
				labelKey: "people.title",
				descriptionKey: "people.description",
				iconId: "users",
				previewHref: "/admin-next/people",
				capability: anyCapability(PERMS.USERS_VIEW),
				routes: [
					{
						id: "users",
						labelKey: "people.users",
						href: "/admin-next/people/users",
						capability: anyCapability(PERMS.USERS_VIEW),
					},
					{
						id: "bans",
						labelKey: "people.bans",
						href: "/admin-next/people/bans",
						capability: anyCapability(PERMS.BANS_VIEW),
					},
				],
				searchProviders: [],
				inboxSources: [],
				widgets: [],
			},
			{
				id: "system",
				labelKey: "system.title",
				descriptionKey: "system.description",
				iconId: "settings",
				previewHref: "/admin-next/system",
				capability: anyCapability(PERMS.SETTINGS_VIEW),
				routes: [],
				searchProviders: [],
				inboxSources: [],
				widgets: [],
			},
		]);
		const translate = vi.fn((key: string) => `translated:${key}`);

		const navigation = buildHousekeepingNavigation(
			registry,
			context([PERMS.USERS_VIEW]),
			translate,
		);

		expect(navigation).toEqual([
			{
				id: "people",
				href: "/admin-next/people",
				iconId: "users",
				label: "translated:people.title",
				description: "translated:people.description",
				items: [
					{
						id: "users",
						href: "/admin-next/people/users",
						label: "translated:people.users",
					},
				],
			},
		]);
		expect(translate).not.toHaveBeenCalledWith("people.bans");
		expect(translate).not.toHaveBeenCalledWith("system.title");
		expect(translate).not.toHaveBeenCalledWith("system.description");
	});
	it("shows real domains to operators authorized by owned migration capabilities", () => {
		const registry = createHousekeepingRegistry(HOUSEKEEPING_MANIFESTS);
		const translate = (key: string) => key;

		expect(
			buildHousekeepingNavigation(
				registry,
				context([PERMS.MOD_CFH_VIEW]),
				translate,
			).map((domain) => domain.id),
		).toContain("people");
		expect(
			buildHousekeepingNavigation(
				registry,
				context([PERMS.MOD_CFH_VIEW]),
				translate,
			).map((domain) => domain.id),
		).not.toContain("economy");

		for (const [slug, expectedDomain] of [
			[PERMS.MOD_ACTIONS, "people"],
			[PERMS.USERS_EDIT, "people"],
			[PERMS.SETTINGS_VIEW, "people"],
			[PERMS.NEWS_EDIT, "content"],
			[PERMS.SHOP_EDIT, "economy"],
			[PERMS.ROOMS_EDIT, "hotel"],
		] as const) {
			const visibleDomainIds = buildHousekeepingNavigation(
				registry,
				context([slug]),
				translate,
			).map((domain) => domain.id);

			expect(visibleDomainIds, slug).toContain(expectedDomain);
		}
	});
});
