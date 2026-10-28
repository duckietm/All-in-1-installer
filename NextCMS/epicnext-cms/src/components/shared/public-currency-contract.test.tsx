import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CurrencyIcon } from "./currency-icon";

const publicCurrencyFiles = [
	"src/app/(site)/rankings/page.tsx",
	"src/app/(site)/leaderboard/page.tsx",
	"src/app/(site)/shop/page.tsx",
	"src/app/(site)/draw-badge/page.tsx",
];

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("public currency presentation contract", () => {
	it.each([
		["credits", "/assets/images/icons/currency/credits.png"],
		["duckets", "/assets/images/icons/currency/duckets.png"],
		["diamonds", "/assets/images/icons/currency/diamonds.png"],
	] as const)("renders the %s asset", (kind, expectedSrc) => {
		const html = renderToStaticMarkup(
			<CurrencyIcon kind={kind} size={22} alt="" />,
		);
		expect(html).toContain(expectedSrc);
		expect(html).toContain('width="22"');
		expect(html).toContain('height="22"');
		expect(html).toContain('alt=""');
	});

	it.each(publicCurrencyFiles)("removes placeholder coins from %s", (path) => {
		const contents = source(path);
		expect(contents).not.toMatch(/className=(?:"coin|\{`coin)/);
		expect(contents).toContain("<CurrencyIcon");
	});

	it("removes the obsolete coin CSS contract", () => {
		expect(source("src/app/globals.css")).not.toContain(".currency .coin");
	});
});
