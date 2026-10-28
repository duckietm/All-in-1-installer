import { describe, expect, it } from "vitest";
import {
	allCapabilities,
	anyCapability,
	type CapabilityRequirement,
	fail,
	type HousekeepingCommand,
	type HousekeepingDomainManifest,
	type HousekeepingInboxSource,
	type HousekeepingInboxSourceResult,
	type HousekeepingQuery,
	type HousekeepingSearchProvider,
	type HousekeepingSearchResult,
	type HousekeepingWidgetDefinition,
	type HousekeepingWorkItem,
	ok,
} from ".";

const capability = anyCapability("admin.users.view");

const workItem = {
	sourceId: "tickets",
	itemId: "ticket-42",
	deduplicationKey: "ticket:42",
	domain: "people",
	capability,
	severity: "warning",
	occurredAt: "2026-08-24T12:00:00.000Z",
	titleKey: "pages.housekeeping.items.ticket",
	context: { ticketId: "42" },
	href: "/admin-next/people/tickets/42",
	freshness: "fresh",
} satisfies HousekeepingWorkItem;

const searchResult = {
	id: "user-42",
	domain: "people",
	title: "operator",
	href: "/admin-next/people/users/42",
} satisfies HousekeepingSearchResult;

const searchProvider: HousekeepingSearchProvider = {
	id: "people.users",
	owner: "people",
	capability,
	search: async () => ok([searchResult], "search-1"),
};

const inboxSourceResult = {
	items: [workItem],
	availability: "available",
} satisfies HousekeepingInboxSourceResult;

const inboxSource: HousekeepingInboxSource = {
	id: "people.tickets",
	owner: "people",
	capability,
	getItems: async () => ok(inboxSourceResult, "inbox-1"),
};

const widget: HousekeepingWidgetDefinition = {
	id: "people.queue",
	owner: "people",
	capability,
	kind: "mandatory",
	load: async () => ok({ count: 2 }, "widget-1"),
};

const query: HousekeepingQuery<{ id: number }, { id: number }> = {
	id: "people.user",
	owner: "people",
	capability,
	run: async (_context, input) => ok(input, "query-1"),
};

const command: HousekeepingCommand<{ id: number }, { id: number }> = {
	id: "people.user.disable",
	owner: "people",
	risk: "sensitive",
	capability,
	requiresReason: true,
	execute: async (_context, input) => ok(input, "command-1"),
};

const manifest: HousekeepingDomainManifest = {
	id: "people",
	labelKey: "pages.housekeeping.domains.people.title",
	descriptionKey: "pages.housekeeping.domains.people.description",
	iconId: "users",
	previewHref: "/admin-next/people",
	capability,
	routes: [],
	searchProviders: [searchProvider],
	inboxSources: [inboxSource],
	widgets: [widget],
};

describe("housekeeping foundation contracts", () => {
	it("creates typed success and error results", () => {
		expect(ok({ count: 2 }, "corr-1")).toEqual({
			ok: true,
			data: { count: 2 },
			correlationId: "corr-1",
		});
		expect(fail("CAPABILITY_DENIED", "corr-2")).toEqual({
			ok: false,
			error: { code: "CAPABILITY_DENIED" },
			correlationId: "corr-2",
		});
	});

	it("rejects empty capability requirements", () => {
		expect(() => anyCapability()).toThrow("capability requirement is empty");
		expect(() => allCapabilities()).toThrow("capability requirement is empty");
	});

	it("exports assignable type-only contracts", () => {
		const requirements: readonly CapabilityRequirement[] = [
			capability,
			allCapabilities("admin.users.view"),
		];

		expect([
			workItem,
			searchProvider,
			inboxSource,
			widget,
			query,
			command,
			manifest,
			requirements,
		]).toHaveLength(8);
	});

	it("carries stable ownership and capability metadata for registry entries", () => {
		expect(searchProvider).toMatchObject({
			id: "people.users",
			owner: "people",
			capability,
		});
		expect(inboxSource).toMatchObject({
			id: "people.tickets",
			owner: "people",
			capability,
		});
		expect(widget).toMatchObject({
			id: "people.queue",
			owner: "people",
			capability,
			kind: "mandatory",
		});
	});
});
