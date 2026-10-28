import { describe, expect, it } from "vitest";
import { browserHeaders } from "./browser-headers";

describe("browserHeaders", () => {
	it("defaults to empty destination headers", () => {
		const h = browserHeaders();
		expect(h["User-Agent"]).toContain("Chrome/125");
		expect(h["Sec-Fetch-Mode"]).toBe("cors");
		expect(h["Sec-Fetch-Dest"]).toBe("empty");
		expect(h["Upgrade-Insecure-Requests"]).toBeUndefined();
	});

	it("uses navigate mode for documents", () => {
		const h = browserHeaders("document");
		expect(h["Sec-Fetch-Mode"]).toBe("navigate");
		expect(h["Sec-Fetch-Dest"]).toBe("document");
		expect(h["Upgrade-Insecure-Requests"]).toBe("1");
		expect(h.Accept).toContain("text/html");
	});

	it("uses no-cors mode for images", () => {
		const h = browserHeaders("image");
		expect(h["Sec-Fetch-Mode"]).toBe("no-cors");
		expect(h.Accept).toContain("image/avif");
	});

	it("uses wildcard accept for scripts", () => {
		expect(browserHeaders("script").Accept).toBe("*/*");
	});

	it("merges extra headers last", () => {
		const h = browserHeaders("empty", { "User-Agent": "custom" });
		expect(h["User-Agent"]).toBe("custom");
		expect(h.Accept).toContain("application/json");
	});
});
