import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import itMessages from "@/messages/it.json";
import { HousekeepingPageShell } from "./housekeeping-page-shell";
import { HousekeepingPageState } from "./housekeeping-page-state";

describe("HousekeepingPageState", () => {
	it.each([
		["loading", "status"],
		["empty", "status"],
		["partial", "status"],
		["error", "alert"],
	] as const)("renders %s with the %s role", (state, role) => {
		const pageState =
			state === "partial" ? (
				<HousekeepingPageState
					state="partial"
					partialLabel="Partial data"
					title={`${state} title`}
					description={`${state} description`}
				/>
			) : (
				<HousekeepingPageState
					state={state}
					title={`${state} title`}
					description={`${state} description`}
				/>
			);
		const html = renderToStaticMarkup(pageState);

		expect(html).toContain(`role="${role}"`);
		expect(html).toContain(`>${state} title<`);
		expect(html).toContain(`>${state} description<`);
	});

	it("announces loading politely", () => {
		const loading = renderToStaticMarkup(
			<HousekeepingPageState
				state="loading"
				title="Loading title"
				description="Loading description"
			/>,
		);

		expect(loading).toContain('aria-live="polite"');
	});

	it.each([
		["English", en.pages.housekeeping.states.partial],
		["Italian", itMessages.pages.housekeeping.states.partial],
	] as const)(
		"preserves the partial-state heading and separate localized warning in %s",
		(_locale, copy) => {
			const html = renderToStaticMarkup(
				<HousekeepingPageState
					state="partial"
					partialLabel={copy.label}
					title={copy.title}
					description={copy.description}
				/>,
			);

			expect(html).toMatch(new RegExp(`<h2[^>]*>${copy.title}</h2>`));
			expect(html).toContain(`>${copy.label}</p>`);
			expect(html).toContain('data-state-tone="warning"');
			expect(html).toContain("--admin-warning-border");
			expect(html).toContain("--admin-warning-subtle");
		},
	);

	it("renders supplied retry content for an error without owning a callback", () => {
		const html = renderToStaticMarkup(
			<HousekeepingPageState
				state="error"
				title="Could not load"
				description="Try again later"
				retryAction={<a href="/admin-next/operations">Retry preview</a>}
			/>,
		);

		expect(html).toContain('role="alert"');
		expect(html).toContain('href="/admin-next/operations"');
		expect(html).toContain(">Retry preview<");
	});
});

describe("HousekeepingPageShell", () => {
	it("renders supplied header, context, action, and body content", () => {
		const html = renderToStaticMarkup(
			<HousekeepingPageShell
				title="People"
				description="Review operator-facing people data"
				context={<span>Preview context</span>}
				primaryAction={<a href="/admin-next/people/new">Create preview</a>}
			>
				<p>Page body</p>
			</HousekeepingPageShell>,
		);

		expect(html).toContain("<header");
		expect(html).toContain(">People<");
		expect(html).toContain(">Review operator-facing people data<");
		expect(html).toContain(">Preview context<");
		expect(html).toContain('href="/admin-next/people/new"');
		expect(html).toContain(">Create preview<");
		expect(html).toContain(">Page body</p>");
	});
});
