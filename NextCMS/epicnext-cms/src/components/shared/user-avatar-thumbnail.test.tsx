import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UserAvatarThumbnail } from "./user-avatar-thumbnail";

describe("UserAvatarThumbnail", () => {
	it("renders the supplied figure as a fixed head-only thumbnail", () => {
		const html = renderToStaticMarkup(
			<UserAvatarThumbnail
				figure="hd-180-1.hr-828-45"
				alt="Life avatar"
				options={{ direction: 3 }}
			/>,
		);

		expect(html).toContain("figure=hd-180-1.hr-828-45");
		expect(html).toContain("headonly=1");
		expect(html).toContain("size=l");
		expect(html).toContain("direction=3");
		expect(html).toContain('width="40"');
		expect(html).toContain('height="40"');
		expect(html).toContain('alt="Life avatar"');
		expect(html).toContain("shrink-0");
	});
});
