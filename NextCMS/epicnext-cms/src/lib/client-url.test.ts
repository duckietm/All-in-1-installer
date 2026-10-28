// @ts-nocheck
import { describe, expect, it } from "vitest";
import { buildClientLoginUrl } from "./client-url";

describe("buildClientLoginUrl", () => {
	it("appends sso to a clean URL", () => {
		expect(buildClientLoginUrl("https://game.hotel.nl", "Hotel-uuid")).toBe(
			"https://game.hotel.nl?sso=Hotel-uuid",
		);
	});

	it("uses & when a query string already exists", () => {
		expect(
			buildClientLoginUrl(
				"https://game.hotel.nl/nitro?mode=nostrip&debug=1",
				"Hotel-uuid",
			),
		).toBe("https://game.hotel.nl/nitro?mode=nostrip&debug=1&sso=Hotel-uuid");
	});

	it("replaces an existing sso param", () => {
		expect(
			buildClientLoginUrl("https://game.hotel.nl/nitro?sso=old&mode=1", "new"),
		).toBe("https://game.hotel.nl/nitro?mode=1&sso=new");
		expect(
			buildClientLoginUrl("https://game.hotel.nl/nitro?sso=old", "new"),
		).toBe("https://game.hotel.nl/nitro?sso=new");
	});

	it("keeps a fragment after the sso param", () => {
		expect(
			buildClientLoginUrl("https://game.hotel.nl/nitro#entry", "h-u"),
		).toBe("https://game.hotel.nl/nitro?sso=h-u#entry");
		expect(
			buildClientLoginUrl("https://game.hotel.nl/nitro?sso=old#entry", "h-u"),
		).toBe("https://game.hotel.nl/nitro?sso=h-u#entry");
	});

	it("leaves any existing non-sso fragment intact", () => {
		expect(
			buildClientLoginUrl("https://game.hotel.nl/nitro?tok=1#frag", "th"),
		).toBe("https://game.hotel.nl/nitro?tok=1&sso=th#frag");
	});

	it("encodes the ticket value", () => {
		expect(buildClientLoginUrl("https://game.hotel.nl/", "Ḟancy-ü")).toBe(
			"https://game.hotel.nl/?sso=%E1%B8%9Eancy-%C3%BC",
		);
	});
});
