import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	LaravelEncrypter,
	phpSerializeString,
	phpUnserializeString,
} from "./laravel-encrypter";

// Dynamically generated 32-byte key so no secret is hardcoded in source.
const APP_KEY = `base64:${randomBytes(32).toString("base64")}`;

describe("LaravelEncrypter", () => {
	it("rejects a key that is not 32 bytes", () => {
		expect(() => new LaravelEncrypter("base64:c2hvcnQ=")).toThrow(/32 bytes/);
	});

	it("round-trips encrypt/decrypt (serialize=true, like Laravel encrypt())", () => {
		const enc = new LaravelEncrypter(APP_KEY);
		const plaintext = randomBytes(16).toString("hex");
		const payload = enc.encrypt(plaintext);
		expect(payload).not.toContain(plaintext);
		expect(enc.decrypt(payload)).toBe(plaintext);
	});

	it("round-trips encryptString/decryptString (serialize=false)", () => {
		const enc = new LaravelEncrypter(APP_KEY);
		const payload = enc.encryptString("hello world");
		expect(enc.decryptString(payload)).toBe("hello world");
	});

	it("fails closed when the auth tag is tampered", () => {
		const enc = new LaravelEncrypter(APP_KEY);
		const payload = enc.encrypt("x");
		const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
		json.tag = Buffer.alloc(16).toString("base64"); // zeroed auth tag
		const tampered = Buffer.from(JSON.stringify(json), "utf8").toString(
			"base64",
		);
		expect(() => enc.decrypt(tampered)).toThrow();
	});

	it("decrypts a payload produced with a fresh instance of the same key", () => {
		const payload = new LaravelEncrypter(APP_KEY).encrypt("shared");
		expect(new LaravelEncrypter(APP_KEY).decrypt(payload)).toBe("shared");
	});
});

describe("php string (de)serialization", () => {
	it("serializes by byte length", () => {
		expect(phpSerializeString("hello")).toBe('s:5:"hello";');
		expect(phpSerializeString("café")).toBe('s:5:"café";'); // é is 2 bytes
	});

	it("round-trips including multibyte", () => {
		expect(phpUnserializeString(phpSerializeString("café"))).toBe("café");
		expect(phpUnserializeString('s:5:"hello";')).toBe("hello");
	});
});
