/**
 * One-time migration: re-encrypt existing AES-256-CBC payloads in
 * `users.two_factor_secret` to AES-256-GCM.
 *
 * After this script completes successfully, every stored value is
 * readable by the new GCM-based LaravelEncrypter.
 *
 * Usage:
 *   npx tsx scripts/migrate-aes-cbc-to-gcm.ts
 */
import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import { eq, isNotNull } from "drizzle-orm";
import { db, User } from "../src/lib/db";

function getKey(appKey: string): Buffer {
	const raw = appKey.startsWith("base64:")
		? Buffer.from(appKey.slice("base64:".length), "base64")
		: Buffer.from(appKey, "utf8");
	if (raw.length !== 32) {
		throw new Error(`APP_KEY must decode to 32 bytes (got ${raw.length})`);
	}
	return raw;
}

/** OLD: AES-256-CBC decrypt with HMAC-SHA256 verification. */
function decryptCbc(payload: string, key: Buffer, serialize = true): string {
	const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as {
		iv: string;
		value: string;
		mac: string;
	};
	const expected = createHmac("sha256", key)
		.update(json.iv + json.value)
		.digest("hex");
	const a = Buffer.from(expected, "hex");
	const b = Buffer.from(json.mac, "hex");
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		throw new Error("The MAC is invalid (CBC payload).");
	}
	const iv = Buffer.from(json.iv, "base64");
	const decipher = createDecipheriv("aes-256-cbc", key, iv);
	const plain =
		decipher.update(json.value, "base64", "utf8") + decipher.final("utf8");
	return serialize ? phpUnserializeString(plain) : plain;
}

/** NEW: AES-256-GCM encrypt (mirrors current LaravelEncrypter). */
function encryptGcm(plaintext: string, key: Buffer, serialize = true): string {
	const iv = randomBytes(12);
	const data = serialize ? phpSerializeString(plaintext) : plaintext;
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const valueB64 =
		cipher.update(data, "utf8", "base64") + cipher.final("base64");
	const tag = cipher.getAuthTag();
	const ivB64 = iv.toString("base64");
	const tagB64 = tag.toString("base64");
	const payload = JSON.stringify({ iv: ivB64, value: valueB64, tag: tagB64 });
	return Buffer.from(payload, "utf8").toString("base64");
}

/** Tries to decrypt a payload with the NEW GCM logic; if it works, skip. */
function isAlreadyGcm(payload: string, _key: Buffer): boolean {
	try {
		const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
		if (!json.tag && !json.mac) return false; // can't determine format
		if (json.tag) return true; // has authTag => GCM
		return false; // has mac => CBC
	} catch {
		return false;
	}
}

async function main() {
	const appKey = process.env.APP_KEY;
	if (!appKey) {
		console.error("APP_KEY environment variable is required.");
		process.exit(1);
	}
	const key = getKey(appKey);

	const users = await db
		.select({ id: User.id, twoFactorSecret: User.twoFactorSecret })
		.from(User)
		.where(isNotNull(User.twoFactorSecret));

	console.log(`Found ${users.length} user(s) with a twoFactorSecret.`);

	let migrated = 0;
	let skipped = 0;
	let errors = 0;

	for (const user of users) {
		if (!user.twoFactorSecret) continue;

		if (isAlreadyGcm(user.twoFactorSecret, key)) {
			console.log(`  [SKIP] User ${user.id} — already GCM`);
			skipped++;
			continue;
		}

		try {
			const plaintext = decryptCbc(user.twoFactorSecret, key);
			const reEncrypted = encryptGcm(plaintext, key);
			await db
				.update(User)
				.set({ twoFactorSecret: reEncrypted })
				.where(eq(User.id, user.id));
			console.log(`  [OK]   User ${user.id} — migrated`);
			migrated++;
		} catch (err) {
			console.error(`  [FAIL] User ${user.id} — ${err}`);
			errors++;
		}
	}

	console.log(
		`\nDone: ${migrated} migrated, ${skipped} skipped, ${errors} errors.`,
	);
	if (errors > 0) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

/* ---- helpers (mirrored from laravel-encrypter.ts) ---- */

function phpSerializeString(value: string): string {
	return `s:${Buffer.byteLength(value, "utf8")}:"${value}";`;
}

function phpUnserializeString(serialized: string): string {
	const m = /^s:(\d+):"/.exec(serialized);
	if (!m) throw new Error("Not a serialized PHP string");
	const byteLen = Number(m[1]);
	const start = m[0].length;
	const bytes = Buffer.from(serialized, "utf8").subarray(
		Buffer.byteLength(serialized.slice(0, start), "utf8"),
	);
	return bytes.subarray(0, byteLen).toString("utf8");
}
