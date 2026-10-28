import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FurnitureInspection } from "@/lib/furni/studio-inspection";
import { FurnitureCompleteness } from "./furniture-completeness";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
const empty: FurnitureInspection = {
	classname: "chair",
	sql: [],
	catalog: [],
	furnidata: [],
	furnidataReadable: true,
	nitro: { exists: false, bytes: 0 },
	icon: { exists: false, bytes: 0 },
};
describe("completeness panel", () => {
	it("renders five separately named parts with useful missing-data guidance", () => {
		const html = renderToStaticMarkup(<FurnitureCompleteness local={empty} />);
		for (const part of ["sql", "catalog", "furnidata", "icon", "nitro"]) {
			expect(html).toContain(`parts.${part}`);
			expect(html).toContain(`actions.${part}`);
		}
		expect(html).not.toContain('href="/admin/studio/audit"');
	});
	it("gives conflicts an accessible action to open the real audit page", () => {
		const local = {
			...empty,
			sql: [
				{ id: 1, spriteId: 1, type: "s", name: "Chair" },
				{ id: 2, spriteId: 2, type: "s", name: "Chair" },
			],
		};
		const html = renderToStaticMarkup(<FurnitureCompleteness local={local} />);
		expect(html).toContain('role="alert"');
		expect(html).toContain('href="/admin/studio/audit"');
		expect(html).toContain("actions.audit");
	});
	it("renders unavailable checks as unverified with a recheck instruction", () => {
		const html = renderToStaticMarkup(
			<FurnitureCompleteness
				local={{
					...empty,
					furnidataReadable: false,
					icon: { exists: null, bytes: 0 },
				}}
			/>,
		);
		expect(html.match(/statuses.unknown/g)).toHaveLength(2);
		expect(html.match(/actions.recheck/g)).toHaveLength(2);
	});
});
