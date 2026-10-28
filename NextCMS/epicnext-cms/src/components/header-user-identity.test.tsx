import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeaderUserIdentity } from "./header-user-identity";

describe("HeaderUserIdentity", () => {
	it("keeps the 40px head separated from the username", () => {
		const html = renderToStaticMarkup(
			<HeaderUserIdentity
				figure="hd-180-1.hr-828-45"
				username="Life"
				textColor="#ffffff"
			/>,
		);

		expect(html).toContain("gap-2");
		expect(html).toContain('width="40"');
		expect(html).toContain('height="40"');
		expect(html).toContain(">Life</span>");
		expect(html).not.toContain("-ml-");
	});
});
