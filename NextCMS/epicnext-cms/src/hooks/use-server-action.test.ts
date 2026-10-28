import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract test rather than a render test: the project runs Vitest in the node
 * environment without a DOM or React testing library, so the refresh decision is
 * asserted on the source. The behaviour it protects is a one-line branch, and
 * the reasoning behind it (Next.js re-renders revalidating actions as part of
 * the action response, so an explicit refresh is a duplicate round-trip) is
 * documented at the option itself.
 */
const source = readFileSync(
	resolve(process.cwd(), "src/hooks/use-server-action.ts"),
	"utf8",
);

describe("useServerAction refresh handling", () => {
	it("refreshes unless the caller marked the action as revalidating", () => {
		expect(source).toMatch(/revalidated = false/);
		expect(source).toMatch(/else if \(!revalidated\) router\.refresh\(\);/);
	});

	it("keeps refreshing on the default path", () => {
		// The refresh must stay the fallback: an action that does not revalidate
		// leaves the screen stale without it.
		expect(source).not.toMatch(/router\.refresh\(\);\s*\}\s*else/);
	});

	it("documents why the refresh can be skipped", () => {
		expect(source).toContain("revalidatePath");
		expect(source).toContain("duplicate round-trip");
	});

	it("callers that opt in point at an action that revalidates", () => {
		const files = [
			"src/app/(site)/polls/[id]/poll-vote-form.tsx",
			"src/app/(site)/events/[slugOrId]/event-register-button.tsx",
		];
		for (const file of files) {
			const caller = readFileSync(resolve(process.cwd(), file), "utf8");
			expect(caller).toContain("revalidated: true");
		}

		// …and the actions they name must actually revalidate their own route.
		const polls = readFileSync(
			resolve(process.cwd(), "src/actions/polls.ts"),
			"utf8",
		);
		expect(polls).toContain('revalidatePath("/polls")');

		const events = readFileSync(
			resolve(process.cwd(), "src/actions/events.ts"),
			"utf8",
		);
		expect(events).toContain('revalidatePath("/events")');
	});
});
