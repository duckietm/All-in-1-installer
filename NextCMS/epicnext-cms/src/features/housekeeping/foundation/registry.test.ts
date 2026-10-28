import { describe, expect, it } from "vitest";
import { PERMS } from "@/lib/permission-slugs";
import { HOUSEKEEPING_MANIFESTS } from "../manifests";
import { HOUSEKEEPING_MIGRATION_MATRIX } from "../migration/matrix";
import {
	HOUSEKEEPING_DOMAIN_IDS,
	type HousekeepingDomainId,
} from "../migration/types";
import {
	anyCapability,
	type CapabilityRequirement,
	type HousekeepingDomainManifest,
	type HousekeepingInboxSource,
	type HousekeepingSearchProvider,
	type HousekeepingWidgetDefinition,
	ok,
} from "./contracts";
import { createHousekeepingRegistry } from "./registry";

const manifest = (
	id: HousekeepingDomainId,
	capabilitySlug = PERMS.ADMIN_DASHBOARD,
): HousekeepingDomainManifest => ({
	id,
	labelKey: `pages.housekeeping.domains.${id}.title`,
	descriptionKey: `pages.housekeeping.domains.${id}.description`,
	iconId: "settings",
	previewHref: `/admin-next/${id}`,
	capability: anyCapability(capabilitySlug),
	routes: [],
	searchProviders: [],
	inboxSources: [],
	widgets: [],
});

const providerCapability = anyCapability(PERMS.USERS_VIEW);

const searchProvider = (
	id: string,
	owner: HousekeepingDomainId = "people",
	capability: CapabilityRequirement = providerCapability,
): HousekeepingSearchProvider => ({
	id,
	owner,
	capability,
	search: async () => ok([], "search"),
});

const inboxSource = (
	id: string,
	owner: HousekeepingDomainId = "people",
	capability: CapabilityRequirement = providerCapability,
): HousekeepingInboxSource => ({
	id,
	owner,
	capability,
	getItems: async () => ok({ items: [], availability: "available" }, "inbox"),
});

const widget = (
	id: string,
	owner: HousekeepingDomainId = "people",
	capability: CapabilityRequirement = providerCapability,
): HousekeepingWidgetDefinition => ({
	id,
	owner,
	capability,
	kind: "optional",
	load: async () => ok(null, "widget"),
});

const expectedManifests = [
	{
		id: "operations",
		iconId: "inbox",
		previewHref: "/admin-next/operations",
		labelKey: "pages.housekeeping.domains.operations.title",
		descriptionKey: "pages.housekeeping.domains.operations.description",
		slugs: [PERMS.ADMIN_DASHBOARD, PERMS.ASSETS_IMPORT],
		routes: [],
	},
	{
		id: "people",
		iconId: "users",
		previewHref: "/admin-next/people",
		labelKey: "pages.housekeeping.domains.people.title",
		descriptionKey: "pages.housekeeping.domains.people.description",
		slugs: [
			PERMS.USERS_VIEW,
			PERMS.MODERATION_VIEW,
			PERMS.TICKETS_VIEW,
			PERMS.BANS_VIEW,
			PERMS.MOD_DASHBOARD,
			PERMS.MOD_CFH_VIEW,
			PERMS.MOD_TEAM_VIEW,
			PERMS.MOD_TICKETS_VIEW,
			PERMS.MOD_USERS_VIEW,
			PERMS.MOD_BANS_VIEW,
			PERMS.USERS_EDIT,
			PERMS.USERS_BAN,
			PERMS.USERS_RESET_PASSWORD,
			PERMS.MODERATION_EDIT,
			PERMS.TICKETS_EDIT,
			PERMS.SETTINGS_VIEW,
			PERMS.SETTINGS_EDIT,
			PERMS.WORDFILTER_VIEW,
			PERMS.WORDFILTER_EDIT,
			PERMS.MOD_ACTIONS,
			PERMS.MOD_CFH_EDIT,
			PERMS.MOD_TICKETS_EDIT,
		],
		routes: [],
	},
	{
		id: "content",
		iconId: "file-text",
		previewHref: "/admin-next/content",
		labelKey: "pages.housekeeping.domains.content.title",
		descriptionKey: "pages.housekeeping.domains.content.description",
		slugs: [
			PERMS.NEWS_VIEW,
			PERMS.PAGES_VIEW,
			PERMS.BANNERS_VIEW,
			PERMS.EVENTS_VIEW,
			PERMS.POLLS_VIEW,
			PERMS.PREFIXES_VIEW,
			PERMS.NEWS_EDIT,
			PERMS.PAGES_EDIT,
			PERMS.BANNERS_EDIT,
			PERMS.EVENTS_EDIT,
			PERMS.POLLS_EDIT,
			PERMS.PREFIXES_EDIT,
			PERMS.SETTINGS_VIEW,
			PERMS.SETTINGS_EDIT,
		],
		routes: [],
	},
	{
		id: "economy",
		iconId: "gem",
		previewHref: "/admin-next/economy",
		labelKey: "pages.housekeeping.domains.economy.title",
		descriptionKey: "pages.housekeeping.domains.economy.description",
		slugs: [
			PERMS.CATALOG_VIEW,
			PERMS.SHOP_VIEW,
			PERMS.CATALOG_EDIT,
			PERMS.SHOP_EDIT,
			PERMS.REFERRALS_VIEW,
			PERMS.REFERRALS_EDIT,
			PERMS.DAILY_REWARDS_VIEW,
			PERMS.DAILY_REWARDS_EDIT,
		],
		routes: [],
	},
	{
		id: "hotel",
		iconId: "hotel",
		previewHref: "/admin-next/hotel",
		labelKey: "pages.housekeeping.domains.hotel.title",
		descriptionKey: "pages.housekeeping.domains.hotel.description",
		slugs: [
			PERMS.ROOMS_VIEW,
			PERMS.RADIO_VIEW,
			PERMS.ASSETS_IMPORT,
			PERMS.ROOMS_EDIT,
			PERMS.ROOMS_DELETE,
			PERMS.RADIO_EDIT,
			PERMS.PAGES_VIEW,
			PERMS.CATALOG_EDIT,
		],
		routes: [
			{
				id: "theme-manager",
				labelKey: "pages.housekeeping.domains.hotel.routes.themeManager",
				href: "/admin-next/hotel/theme-manager",
				capability: {
					mode: "any",
					slugs: [PERMS.SETTINGS_VIEW, PERMS.SETTINGS_EDIT],
				},
			},
			{
				id: "nitro-cleanup",
				labelKey: "pages.housekeeping.domains.hotel.routes.nitroCleanup",
				href: "/admin-next/hotel/nitro-cleanup",
				capability: { mode: "any", slugs: [PERMS.ASSETS_IMPORT] },
			},
		],
	},
	{
		id: "system",
		iconId: "settings",
		previewHref: "/admin-next/system",
		labelKey: "pages.housekeeping.domains.system.title",
		descriptionKey: "pages.housekeeping.domains.system.description",
		slugs: [
			PERMS.SETTINGS_VIEW,
			PERMS.LOGS_VIEW,
			PERMS.ANALYTICS_VIEW,
			PERMS.DEVOPS_VIEW,
			PERMS.DEVOPS_EDIT,
			PERMS.NOTIFICATIONS_VIEW,
			PERMS.PERMISSIONS_MANAGE,
			PERMS.RCON_EXECUTE,
			PERMS.SETTINGS_EDIT,
			PERMS.NOTIFICATIONS_EDIT,
		],
		routes: [],
	},
] as const;
describe("housekeeping registry", () => {
	it("registers the six approved domains in their locked order", () => {
		const registry = createHousekeepingRegistry(HOUSEKEEPING_MANIFESTS);

		expect(registry.domains.map((domain) => domain.id)).toEqual(
			HOUSEKEEPING_DOMAIN_IDS,
		);
		expect(Object.isFrozen(registry.domains)).toBe(true);
	});

	it("rejects duplicate and unknown domain identifiers", () => {
		expect(() =>
			createHousekeepingRegistry([
				manifest("operations"),
				manifest("operations"),
			]),
		).toThrow("duplicate domain id");
		expect(() =>
			createHousekeepingRegistry([
				{ ...manifest("operations"), id: "future" as HousekeepingDomainId },
			]),
		).toThrow("unknown domain id");
	});

	it("rejects invalid preview and empty translation keys", () => {
		expect(() =>
			createHousekeepingRegistry([
				{ ...manifest("people"), previewHref: "/admin-next/operations" },
			]),
		).toThrow("invalid preview href");
		expect(() =>
			createHousekeepingRegistry([{ ...manifest("people"), labelKey: "  " }]),
		).toThrow("empty label key");
		expect(() =>
			createHousekeepingRegistry([
				{ ...manifest("people"), descriptionKey: "\t" },
			]),
		).toThrow("empty description key");
	});

	it("rejects duplicate route identities and hrefs", () => {
		const base = manifest("people");

		expect(() =>
			createHousekeepingRegistry([
				{
					...base,
					routes: [
						{
							id: "users",
							labelKey: "pages.housekeeping.domains.people.title",
							href: "/admin-next/people/users",
							capability: anyCapability(PERMS.USERS_VIEW),
						},
						{
							id: "users",
							labelKey: "pages.housekeeping.domains.people.title",
							href: "/admin-next/people/staff",
							capability: anyCapability(PERMS.USERS_VIEW),
						},
					],
				},
			]),
		).toThrow("duplicate route id");
		expect(() =>
			createHousekeepingRegistry([
				{
					...base,
					routes: [
						{
							id: "users",
							labelKey: "pages.housekeeping.domains.people.title",
							href: "/admin-next/people/users",
							capability: anyCapability(PERMS.USERS_VIEW),
						},
						{
							id: "staff",
							labelKey: "pages.housekeeping.domains.people.title",
							href: "/admin-next/people/users",
							capability: anyCapability(PERMS.USERS_VIEW),
						},
					],
				},
			]),
		).toThrow("duplicate route href");
	});

	it("rejects empty route fields and unknown capability slugs", () => {
		const route = {
			id: "users",
			labelKey: "pages.housekeeping.domains.people.title",
			href: "/admin-next/people/users",
			capability: anyCapability(PERMS.USERS_VIEW),
		};

		expect(() =>
			createHousekeepingRegistry([
				{ ...manifest("people"), routes: [{ ...route, id: " " }] },
			]),
		).toThrow("empty route id");
		expect(() =>
			createHousekeepingRegistry([
				{ ...manifest("people"), routes: [{ ...route, href: " " }] },
			]),
		).toThrow("empty route href");
		expect(() =>
			createHousekeepingRegistry([
				{ ...manifest("people"), routes: [{ ...route, labelKey: " " }] },
			]),
		).toThrow("empty route label key");
		expect(() =>
			createHousekeepingRegistry([
				{
					...manifest("system"),
					capability: anyCapability("admin.ghost.view"),
				},
			]),
		).toThrow("unknown capability slug: admin.ghost.view");
		expect(() =>
			createHousekeepingRegistry([
				{
					...manifest("people"),
					routes: [
						{ ...route, capability: anyCapability("admin.ghost.route") },
					],
				},
			]),
		).toThrow("unknown capability slug: admin.ghost.route");
	});
	it("locks every real manifest to its approved presentation and capability group", () => {
		expect(HOUSEKEEPING_MANIFESTS).toHaveLength(6);

		for (const [index, expected] of expectedManifests.entries()) {
			const actual = HOUSEKEEPING_MANIFESTS[index];

			expect(actual).toMatchObject({
				id: expected.id,
				iconId: expected.iconId,
				previewHref: expected.previewHref,
				labelKey: expected.labelKey,
				descriptionKey: expected.descriptionKey,
			});
			expect(actual.routes).toEqual(expected.routes);
			expect(actual.searchProviders).toEqual([]);
			expect(actual.inboxSources).toEqual([]);
			expect(actual.widgets).toEqual([]);
			expect(actual.capability).toEqual({ mode: "any", slugs: expected.slugs });
		}
	});

	it("covers every capability attributed to each domain's migration rows", () => {
		for (const manifest of HOUSEKEEPING_MANIFESTS) {
			const attributedCapabilities = new Set(
				HOUSEKEEPING_MIGRATION_MATRIX.filter(
					(entry) => entry.targetDomain === manifest.id,
				).flatMap((entry) => [
					...entry.capabilities.read,
					...entry.capabilities.mutate,
				]),
			);

			for (const slug of attributedCapabilities) {
				expect(
					manifest.capability.slugs,
					`domain ${manifest.id}: ${slug}`,
				).toContain(slug);
			}
		}
	});

	it("rejects duplicate provider and widget ids across domain manifests", () => {
		expect(() =>
			createHousekeepingRegistry([
				{ ...manifest("people"), searchProviders: [searchProvider("shared")] },
				{
					...manifest("content"),
					searchProviders: [searchProvider("shared", "content")],
				},
			]),
		).toThrow("duplicate search provider id: shared");
		expect(() =>
			createHousekeepingRegistry([
				{ ...manifest("people"), inboxSources: [inboxSource("shared")] },
				{
					...manifest("content"),
					inboxSources: [inboxSource("shared", "content")],
				},
			]),
		).toThrow("duplicate inbox source id: shared");
		expect(() =>
			createHousekeepingRegistry([
				{ ...manifest("people"), widgets: [widget("shared")] },
				{
					...manifest("content"),
					widgets: [widget("shared", "content")],
				},
			]),
		).toThrow("duplicate widget id: shared");
		expect(() =>
			createHousekeepingRegistry([
				{ ...manifest("people"), searchProviders: [searchProvider("shared")] },
				{
					...manifest("content"),
					widgets: [widget("shared", "content")],
				},
			]),
		).toThrow("duplicate widget id: shared");
	});

	it("rejects provider and widget ownership outside their manifest", () => {
		expect(() =>
			createHousekeepingRegistry([
				{
					...manifest("people"),
					searchProviders: [searchProvider("people.users", "content")],
				},
			]),
		).toThrow("search provider owner mismatch: people.users");
		expect(() =>
			createHousekeepingRegistry([
				{
					...manifest("people"),
					inboxSources: [inboxSource("people.tickets", "content")],
				},
			]),
		).toThrow("inbox source owner mismatch: people.tickets");
		expect(() =>
			createHousekeepingRegistry([
				{
					...manifest("people"),
					widgets: [widget("people.queue", "content")],
				},
			]),
		).toThrow("widget owner mismatch: people.queue");
	});

	it("rejects empty ids and invalid capability shapes for registry metadata", () => {
		const invalidCapability = {
			mode: "some",
			slugs: [PERMS.USERS_VIEW],
		} as unknown as CapabilityRequirement;

		expect(() =>
			createHousekeepingRegistry([
				{ ...manifest("people"), searchProviders: [searchProvider(" ")] },
			]),
		).toThrow("empty search provider id");
		expect(() =>
			createHousekeepingRegistry([
				{
					...manifest("people"),
					inboxSources: [
						inboxSource("people.tickets", "people", invalidCapability),
					],
				},
			]),
		).toThrow("invalid capability requirement");
		expect(() =>
			createHousekeepingRegistry([
				{
					...manifest("people"),
					widgets: [
						widget(
							"people.queue",
							"people",
							anyCapability("admin.ghost.widget"),
						),
					],
				},
			]),
		).toThrow("unknown capability slug: admin.ghost.widget");
	});

	it("rejects widget kinds outside the mandatory or optional contract", () => {
		expect(() =>
			createHousekeepingRegistry([
				{
					...manifest("people"),
					widgets: [
						{ ...widget("people.queue"), kind: "fixed" as "mandatory" },
					],
				},
			]),
		).toThrow("invalid widget kind: people.queue");
	});

	it("rejects empty domain and route capability requirements", () => {
		expect(() =>
			createHousekeepingRegistry([
				{ ...manifest("operations"), capability: { mode: "any", slugs: [] } },
			]),
		).toThrow("empty capability requirement");
		expect(() =>
			createHousekeepingRegistry([
				{
					...manifest("people"),
					routes: [
						{
							id: "users",
							labelKey: "pages.housekeeping.domains.people.title",
							href: "/admin-next/people/users",
							capability: { mode: "any", slugs: [] },
						},
					],
				},
			]),
		).toThrow("empty capability requirement");
	});

	it("rejects duplicate route identities and hrefs across domains", () => {
		const route = {
			id: "shared",
			labelKey: "pages.housekeeping.domains.people.title",
			href: "/admin-next/shared",
			capability: anyCapability(PERMS.USERS_VIEW),
		};

		expect(() =>
			createHousekeepingRegistry([
				{ ...manifest("people"), routes: [route] },
				{
					...manifest("content"),
					routes: [{ ...route, href: "/admin-next/content/shared" }],
				},
			]),
		).toThrow("duplicate route id");
		expect(() =>
			createHousekeepingRegistry([
				{ ...manifest("people"), routes: [route] },
				{
					...manifest("content"),
					routes: [{ ...route, id: "content-shared" }],
				},
			]),
		).toThrow("duplicate route href");
	});
});
