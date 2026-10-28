import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CmsInfoPopup } from "@/components/cms-info-popup";

describe("CmsInfoPopup", () => {
	it("renders the footer trigger", () => {
		const html = renderToStaticMarkup(<CmsInfoPopup />);
		const source = readFileSync(
			resolve(process.cwd(), "src/components/cms-info-popup.tsx"),
			"utf8",
		);
		expect(html).toContain("EpicNext Info");
		expect(source).toContain(">EpicNext<");
		expect(source).toContain("Modern Next.js CMS");
	});
});
