import { describe, expect, it, vi } from "vitest";
import { assertSafeImportUrl } from "./import-url-safety";

vi.mock("node:dns/promises", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:dns/promises")>();
	return {
		...original,
		lookup: vi.fn(async (hostname) => {
			if (hostname === "natty.host") {
				return [{ address: "10.0.0.4", family: 4 }];
			}
			if (hostname === "loopback-hook.test") {
				return [{ address: "127.0.0.1", family: 4 }];
			}
			if (hostname === "v6mine.host") {
				return [{ address: "fd00::1", family: 6 }];
			}
			if (hostname === "nope.invalid") {
				throw new Error("NXDOMAIN");
			}
			return [{ address: "104.18.0.1", family: 4 }];
		}),
	};
});

describe("assertSafeImportUrl", () => {
	it("accepts a public https host", async () => {
		await expect(
			assertSafeImportUrl("https://images.habbo.com/dcr", "x"),
		).resolves.toBeUndefined();
	});

	it("accepts a public IP literal", async () => {
		await expect(
			assertSafeImportUrl("https://8.8.8.8/path", "x"),
		).resolves.toBeUndefined();
	});

	it("rejects a non-https URL", async () => {
		await expect(
			assertSafeImportUrl("http://images.habbo.com", "furnidataUrl"),
		).rejects.toThrow("furnidataUrl must be an https:// URL");
	});

	it("rejects an invalid URL", async () => {
		await expect(
			assertSafeImportUrl("not a url", "nitroBaseUrl"),
		).rejects.toThrow("nitroBaseUrl is not a valid URL");
	});

	it("rejects embedded credentials", async () => {
		await expect(
			assertSafeImportUrl("https://user:pass@images.habbo.com", "x"),
		).rejects.toThrow("must not embed credentials");
	});

	it("rejects a private IP literal", async () => {
		await expect(
			assertSafeImportUrl("https://10.1.2.3/assets", "x"),
		).rejects.toThrow("private address");
		await expect(
			assertSafeImportUrl("https://192.168.0.1/assets", "x"),
		).rejects.toThrow("private address");
		await expect(
			assertSafeImportUrl("https://172.16.5.5/assets", "x"),
		).rejects.toThrow("private address");
	});

	it("rejects a loopback alias and numeric localhost", async () => {
		await expect(
			assertSafeImportUrl("https://localhost/assets", "x"),
		).rejects.toThrow("local host");
		await expect(
			assertSafeImportUrl("https://127.0.0.1/assets", "x"),
		).rejects.toThrow("private address");
	});

	it("rejects a host that resolves to a private address", async () => {
		await expect(
			assertSafeImportUrl("https://natty.host/assets", "x"),
		).rejects.toThrow("resolves to a private address");
	});

	it("rejects a host that resolves to loopback", async () => {
		await expect(
			assertSafeImportUrl("https://loopback-hook.test/assets", "x"),
		).rejects.toThrow("resolves to a private address");
	});

	it("rejects a host that resolves to an IPv6 ULA", async () => {
		await expect(
			assertSafeImportUrl("https://v6mine.host/assets", "x"),
		).rejects.toThrow("resolves to a private address");
	});

	it("rejects a host that does not resolve", async () => {
		await expect(
			assertSafeImportUrl("https://nope.invalid/assets", "x"),
		).rejects.toThrow("does not resolve");
	});

	it("allows an empty url", async () => {
		await expect(assertSafeImportUrl("  ", "x")).resolves.toBeUndefined();
	});
});
