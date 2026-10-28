import { describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
	BCRYPT_COST: 12,
}));

vi.mock("@/env", () => ({
	env: mockEnv,
}));

import {
	checkLogin,
	hashPassword,
	isArgon2Of,
	isBcryptOf,
	isCombinedDigestOf,
	isMd5Of,
	isSaltedDigestOf,
	isSha1Of,
	isSha256Of,
	isSha512Of,
	md5Hex,
	sha1Hex,
	sha256Hex,
	sha512Hex,
	verifyPassword,
} from "./password";

describe("md5Hex", () => {
	it("matches PHP md5() on canonical vectors", async () => {
		expect(await md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
		expect(await md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
	});
});

describe("sha512Hex", () => {
	it("matches canonical vectors", async () => {
		expect(await sha512Hex("abc")).toMatch(/^ddaf35a193617aba/);
	});
});

describe("hashPassword", () => {
	it("emits an Argon2id hash and round-trips", async () => {
		const h = await hashPassword("s3cret!");
		expect(h).toMatch(/^\$argon2id\$/);
		expect(await verifyPassword("s3cret!", h)).toBe(true);
		expect(await verifyPassword("wrong", h)).toBe(false);
	});
});

describe("isArgon2Of", () => {
	it("verifies a legacy argon2id hash (pre-migration accounts)", async () => {
		const stored =
			"$argon2id$v=19$m=1024,t=1,p=1$pTCeoGfX788sH7Z3ju9rJw$4awmR4yciu2L+xDNQJ/NesWX3Kio+fwN8wSCtp4XUp0";
		expect(await isArgon2Of("test-password-123", stored)).toBe(true);
		expect(await isArgon2Of("wrong", stored)).toBe(false);
		expect(await isArgon2Of("anything", "$2y$12$ABC")).toBe(false);
	});

	it("verifies legacy argon2i hashes via hash-wasm round-trip", async () => {
		const { argon2i } = await import("hash-wasm");
		const salt = new Uint8Array(16);
		const stored = await argon2i({
			password: "oldpass",
			salt,
			parallelism: 1,
			iterations: 1,
			memorySize: 1024,
			hashLength: 32,
			outputType: "encoded",
		});
		expect(stored).toMatch(/^\$argon2i\$/);
		expect(await isArgon2Of("oldpass", stored)).toBe(true);
		expect(await isArgon2Of("wrong", stored)).toBe(false);
	});
});

describe("sha digest verifiers", () => {
	it("rejects non-matching lengths", async () => {
		expect(await isSha1Of("x", "zzzz")).toBe(false);
		expect(await isSha256Of("x", "zzzz")).toBe(false);
		expect(await isSha512Of("x", "zzzz")).toBe(false);
	});

	it("verifies sha1 hashes (uppercase and lowercase)", async () => {
		const hex = await sha1Hex("habbo");
		expect(await isSha1Of("habbo", hex)).toBe(true);
		expect(await isSha1Of("habbo", hex.toUpperCase())).toBe(true);
		expect(await isSha1Of("wrong", hex)).toBe(false);
	});

	it("verifies sha256 hashes", async () => {
		const hex = await sha256Hex("habbo");
		expect(await isSha256Of("habbo", hex)).toBe(true);
		expect(await isSha256Of("wrong", hex)).toBe(false);
	});

	it("verifies sha512 hashes", async () => {
		const hex = await sha512Hex("habbo");
		expect(await isSha512Of("habbo", hex)).toBe(true);
		expect(await isSha512Of("wrong", hex)).toBe(false);
	});
});

describe("isBcryptOf", () => {
	it("verifies a bcrypt hash", async () => {
		const { bcrypt } = await import("hash-wasm");
		const { randomBytes } = await import("node:crypto");
		const stored = await bcrypt({
			password: "hunter2",
			salt: randomBytes(16),
			costFactor: 10,
			outputType: "encoded",
		});
		expect(await isBcryptOf("hunter2", stored)).toBe(true);
		expect(await isBcryptOf("wrong", stored)).toBe(false);
		expect(await isBcryptOf("anything", "$argon2id$v=19$")).toBe(false);
	});
});

describe("isMd5Of", () => {
	it("detects a legacy md5 password", async () => {
		expect(await isMd5Of("habbo", await md5Hex("habbo"))).toBe(true);
		expect(await isMd5Of("habbo", await md5Hex("other"))).toBe(false);
		expect(await isMd5Of("habbo", "not-a-hash")).toBe(false);
	});
});

describe("isCombinedDigestOf", () => {
	it("detects UberCMS/Butterfly double-md5 passwords", async () => {
		const stored = await md5Hex(await md5Hex("oldpass"));
		expect(await isCombinedDigestOf("oldpass", stored)).toBe(true);
		expect(await isCombinedDigestOf("wrong", stored)).toBe(false);
		expect(await isCombinedDigestOf("oldpass", "not-a-hash")).toBe(false);
	});

	it("detects md5(sha1(pass)) and sha1(md5(pass)) combos", async () => {
		const a = await md5Hex(await sha1Hex("oldpass"));
		expect(await isCombinedDigestOf("oldpass", a)).toBe(true);
		expect(await isCombinedDigestOf("wrong", a)).toBe(false);

		const b = await sha1Hex(await md5Hex("oldpass"));
		expect(await isCombinedDigestOf("oldpass", b)).toBe(true);
		expect(await isCombinedDigestOf("wrong", b)).toBe(false);
	});

	it("detects double sha1 / double sha256 / double sha512", async () => {
		expect(
			await isCombinedDigestOf(
				"oldpass",
				await sha1Hex(await sha1Hex("oldpass")),
			),
		).toBe(true);
		expect(
			await isCombinedDigestOf(
				"oldpass",
				await sha256Hex(await sha256Hex("oldpass")),
			),
		).toBe(true);
		expect(
			await isCombinedDigestOf(
				"oldpass",
				await sha512Hex(await sha512Hex("oldpass")),
			),
		).toBe(true);
	});
});

describe("isSaltedDigestOf", () => {
	it("verifies md5(salt+password) with hash:salt layout", async () => {
		const salt = "pepper123";
		const stored = `${await md5Hex(`${salt}oldpass`)}:${salt}`;
		expect(await isSaltedDigestOf("oldpass", stored)).toBe(true);
		expect(await isSaltedDigestOf("wrong", stored)).toBe(false);
	});

	it("verifies md5(password+salt) with hash:salt layout", async () => {
		const salt = "pepper123";
		const stored = `${await md5Hex(`oldpass${salt}`)}:${salt}`;
		expect(await isSaltedDigestOf("oldpass", stored)).toBe(true);
	});

	it("verifies the salt:hash layout", async () => {
		const salt = "abc123";
		const stored = `${salt}:${await md5Hex(`${salt}oldpass`)}`;
		expect(await isSaltedDigestOf("oldpass", stored)).toBe(true);
		expect(await isSaltedDigestOf("wrong", stored)).toBe(false);
	});

	it("verifies the hash$salt layout", async () => {
		const salt = "s0lt_9";
		const stored = `${await md5Hex(`oldpass${salt}`)}$s0lt_9`;
		expect(await isSaltedDigestOf("oldpass", stored)).toBe(true);
	});

	it("verifies salted sha1 and sha256 digests", async () => {
		const salt = "pepper123";
		const sha1Stored = `${await sha1Hex(`${salt}oldpass`)}:${salt}`;
		expect(await isSaltedDigestOf("oldpass", sha1Stored)).toBe(true);

		const sha256Stored = `${await sha256Hex(`oldpass${salt}`)}:${salt}`;
		expect(await isSaltedDigestOf("oldpass", sha256Stored)).toBe(true);
	});

	it("rejects junk that does not match any layout", async () => {
		expect(await isSaltedDigestOf("oldpass", "z9z9z9")).toBe(false);
		expect(await isSaltedDigestOf("oldpass", "not-a-hash:xyz")).toBe(false);
	});
});

describe("verifyPassword", () => {
	it("verifies Argon2id hashes", async () => {
		const h = await hashPassword("hunter2");
		expect(h).toMatch(/^\$argon2id\$/);
		expect(await verifyPassword("hunter2", h)).toBe(true);
		expect(await verifyPassword("nope", h)).toBe(false);
	});
});

describe("checkLogin", () => {
	it("upgrades a legacy md5 hash to Argon2id", async () => {
		const stored = await md5Hex("oldpass");
		const res = await checkLogin("oldpass", stored);
		expect(res.valid).toBe(true);
		expect(res.upgradedHash).toMatch(/^\$argon2id\$/);
		expect(await verifyPassword("oldpass", res.upgradedHash as string)).toBe(
			true,
		);
	});

	it("migrates a legacy argon2id hash to Argon2id", async () => {
		const stored =
			"$argon2id$v=19$m=1024,t=1,p=1$pTCeoGfX788sH7Z3ju9rJw$4awmR4yciu2L+xDNQJ/NesWX3Kio+fwN8wSCtp4XUp0";
		const res = await checkLogin("test-password-123", stored);
		expect(res.valid).toBe(true);
		expect(res.upgradedHash).toMatch(/^\$argon2id\$/);
	});

	for (const [name, hashThePassword] of [
		["sha1", sha1Hex],
		["sha256", sha256Hex],
		["sha512", sha512Hex],
	] as const) {
		it(`migrates a legacy ${name} hash to Argon2id`, async () => {
			const stored = await hashThePassword("oldpass");
			const res = await checkLogin("oldpass", stored);
			expect(res.valid).toBe(true);
			expect(res.upgradedHash).toMatch(/^\$argon2id\$/);
			expect(await verifyPassword("oldpass", res.upgradedHash as string)).toBe(
				true,
			);
		});
	}

	it("migrates a combined digest hash to Argon2id (md5(md5(pass)))", async () => {
		const stored = await md5Hex(await md5Hex("oldpass"));
		const res = await checkLogin("oldpass", stored);
		expect(res.valid).toBe(true);
		expect(res.upgradedHash).toMatch(/^\$argon2id\$/);
	});

	it("migrates a combined digest hash to Argon2id (sha1(md5(pass)))", async () => {
		const stored = await sha1Hex(await md5Hex("oldpass"));
		const res = await checkLogin("oldpass", stored);
		expect(res.valid).toBe(true);
		expect(res.upgradedHash).toMatch(/^\$argon2id\$/);
	});

	it("migrates a salted md5 hash to Argon2id (md5(salt+password))", async () => {
		const salt = "pepper123";
		const stored = `${await md5Hex(`${salt}oldpass`)}:${salt}`;
		const res = await checkLogin("oldpass", stored);
		expect(res.valid).toBe(true);
		expect(res.upgradedHash).toMatch(/^\$argon2id\$/);
		expect(await verifyPassword("oldpass", res.upgradedHash as string)).toBe(
			true,
		);
	});

	it("migrates a salted sha256 hash to Argon2id (sha256(salt+password))", async () => {
		const salt = "abc123";
		const stored = `${salt}:${await sha256Hex(`${salt}oldpass`)}`;
		const res = await checkLogin("oldpass", stored);
		expect(res.valid).toBe(true);
		expect(res.upgradedHash).toMatch(/^\$argon2id\$/);
	});

	it("rejects a wrong password for salted/combined hashes", async () => {
		const salted = `${await md5Hex("pepper123oldpass")}:pepper123`;
		const combined = await sha1Hex(await md5Hex("oldpass"));
		expect((await checkLogin("wrongpass", salted)).valid).toBe(false);
		expect((await checkLogin("wrongpass", combined)).valid).toBe(false);
	});

	it("accepts a raw plaintext password and upgrades it to Argon2id", async () => {
		const res = await checkLogin("hunter44", "hunter44");
		expect(res.valid).toBe(true);
		expect(res.upgradedHash).toMatch(/^\$argon2id\$/);
		expect(await verifyPassword("hunter44", res.upgradedHash as string)).toBe(
			true,
		);
	});

	it("does not treat short/junk stored values as plaintext", async () => {
		expect((await checkLogin("abc", "abc")).valid).toBe(false);
		expect((await checkLogin("x", "")).valid).toBe(false);
		expect((await checkLogin("pass", "not-a-hash-format")).valid).toBe(false);
	});

	it("accepts an existing bcrypt hash with no rehash", async () => {
		const { bcrypt } = await import("hash-wasm");
		const { randomBytes } = await import("node:crypto");
		const stored = await bcrypt({
			password: "modern",
			salt: randomBytes(16),
			costFactor: 10,
			outputType: "encoded",
		});
		const res = await checkLogin("modern", stored);
		expect(res.valid).toBe(true);
		expect(res.upgradedHash).toBeUndefined();
	});

	it("rejects a wrong password regardless of format", async () => {
		const stored = await md5Hex("oldpass");
		const res = await checkLogin("wrongpass", stored);
		expect(res.valid).toBe(false);
		expect(res.upgradedHash).toBeUndefined();
	});
});
