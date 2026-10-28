import { describe, expect, it } from "vitest";
import {
	generateTotp,
	generateTotpSecret,
	totpKeyUri,
	verifyTotp,
} from "./totp";

describe("totp", () => {
	const SECRET = generateTotpSecret();
	it("verifies the current generated code", () => {
		const code = generateTotp(SECRET);
		expect(code).toMatch(/^\d{6}$/);
		expect(verifyTotp(code, SECRET)).toBe(true);
	});

	it("rejects a wrong code", () => {
		expect(verifyTotp("000000", SECRET)).toBe(false);
	});

	it("rejects malformed input without throwing", () => {
		expect(verifyTotp("not-a-code", SECRET)).toBe(false);
	});

	it("builds an otpauth provisioning URI", () => {
		const uri = totpKeyUri(SECRET, "alice", "AtomHotel");
		expect(uri.startsWith("otpauth://totp/")).toBe(true);
		expect(uri).toContain(`secret=${SECRET}`);
		expect(uri).toContain("issuer=AtomHotel");
	});
});
