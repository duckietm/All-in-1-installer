import { expect, it, vi } from "vitest";
import { collectOperations } from "./operations-inbox";

it("does not load unauthorized sources and reports failed sources separately", async () => {
	const denied = vi.fn();
	const result = await collectOperations([
		{ source: "errors", allowed: false, load: denied },
		{
			source: "imports",
			allowed: true,
			load: async () => {
				throw Error("offline");
			},
		},
	]);
	expect(denied).not.toHaveBeenCalled();
	expect(result).toEqual({ items: [], unavailable: ["imports"] });
});
it("deduplicates, prioritizes and excludes empty work", async () => {
	const item = {
		id: "one",
		source: "errors" as const,
		href: "/admin/devops/cms-errors",
		count: 2,
		severity: 3,
	};
	const result = await collectOperations([
		{
			source: "errors",
			allowed: true,
			load: async () => [item, item, { ...item, id: "empty", count: 0 }],
		},
	]);
	expect(result.items).toEqual([item]);
});
