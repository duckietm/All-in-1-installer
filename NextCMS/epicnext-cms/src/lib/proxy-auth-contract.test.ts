// @ts-nocheck
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("proxy authentication boundary", () => {
	it("uses getToken directly without database-dependent Auth.js config", () => {
		const proxy = readFileSync("src/proxy.ts", "utf8");

		expect(proxy).not.toContain('from "@/lib/proxy-auth"');
		expect(proxy).not.toContain('from "@/lib/auth"');
		expect(proxy).toContain("getToken");
		expect(proxy).toContain("next-auth/jwt");
	});
});
