import { randomBytes } from "node:crypto";
import {
	argon2id,
	argon2Verify,
	bcrypt,
	bcryptVerify,
	md5,
	sha1,
	sha256,
	sha512,
} from "hash-wasm";

import { env } from "@/env";

/** Argon2id parameters — memory-hard, GPU-resistant. */
const ARGON2_CONFIG = {
	memorySize: 19456, // ~19 MiB
	iterations: 2,
	parallelism: 1,
	hashLength: 32,
};

/** Hash new passwords with Argon2id (best practice 2024+). */
export async function hashPassword(password: string): Promise<string> {
	return await argon2id({
		password,
		salt: randomBytes(16),
		...ARGON2_CONFIG,
		outputType: "encoded",
	});
}

/** Legacy bcrypt for migrating existing hashes. */
export async function hashPasswordBcrypt(password: string): Promise<string> {
	return await bcrypt({
		password,
		salt: randomBytes(16),
		costFactor: env.BCRYPT_COST,
		outputType: "encoded",
	});
}

export async function md5Hex(input: string): Promise<string> {
	return await md5(input);
}
export async function sha1Hex(input: string): Promise<string> {
	return await sha1(input);
}
export async function sha256Hex(input: string): Promise<string> {
	return await sha256(input);
}
export async function sha512Hex(input: string): Promise<string> {
	return await sha512(input);
}

/** Matches an unsalted lowercase/uppercase hex digest of a given length. */
async function isHexDigestOf(
	password: string,
	stored: string,
	length: number,
	hashFn: (input: string) => Promise<string>,
): Promise<boolean> {
	if (!new RegExp(`^[a-f0-9]{${length}}$`, "i").test(stored)) return false;
	return (await hashFn(password)) === stored.toLowerCase();
}

/**
 * Single source of truth for the supported unsalted digest families. Both the
 * plain single-digest checks and the salted detection below derive from here,
 * so adding a family (e.g. sha384) means adding a single row.
 */
const DIGEST_SCHEMES: ReadonlyArray<{
	length: number;
	hash: (input: string) => Promise<string>;
}> = [
	{ length: 32, hash: md5Hex },
	{ length: 40, hash: sha1Hex },
	{ length: 64, hash: sha256Hex },
	{ length: 128, hash: sha512Hex },
];

export async function isMd5Of(
	password: string,
	stored: string,
): Promise<boolean> {
	return isHexDigestOf(password, stored, 32, md5Hex);
}

export async function isSha1Of(
	password: string,
	stored: string,
): Promise<boolean> {
	return isHexDigestOf(password, stored, 40, sha1Hex);
}

export async function isSha256Of(
	password: string,
	stored: string,
): Promise<boolean> {
	return isHexDigestOf(password, stored, 64, sha256Hex);
}

export async function isSha512Of(
	password: string,
	stored: string,
): Promise<boolean> {
	return isHexDigestOf(password, stored, 128, sha512Hex);
}

/**
 * Combined/double digest conventions used by legacy CMSes and forums, e.g.
 * md5(md5(pass)) (UberCMS/Butterfly), md5(sha1(pass)), sha1(md5(pass)),
 * double sha1 / double sha256, and cross md5/sha512 combinations.
 */
const COMBINED_DIGEST_SCHEMES: ReadonlyArray<{
	inner: (input: string) => Promise<string>;
	outer: (input: string) => Promise<string>;
	length: number;
}> = [
	{ outer: md5Hex, inner: md5Hex, length: 32 },
	{ outer: sha1Hex, inner: md5Hex, length: 40 },
	{ outer: md5Hex, inner: sha1Hex, length: 32 },
	{ outer: sha1Hex, inner: sha1Hex, length: 40 },
	{ outer: sha256Hex, inner: md5Hex, length: 64 },
	{ outer: md5Hex, inner: sha256Hex, length: 32 },
	{ outer: sha256Hex, inner: sha1Hex, length: 64 },
	{ outer: sha1Hex, inner: sha256Hex, length: 40 },
	{ outer: sha256Hex, inner: sha256Hex, length: 64 },
	{ outer: sha512Hex, inner: md5Hex, length: 128 },
	{ outer: md5Hex, inner: sha512Hex, length: 32 },
	{ outer: sha512Hex, inner: sha512Hex, length: 128 },
];

export async function isCombinedDigestOf(
	password: string,
	stored: string,
): Promise<boolean> {
	const storedLower = stored.toLowerCase();
	for (const { inner, outer, length } of COMBINED_DIGEST_SCHEMES) {
		if (!new RegExp(`^[a-f0-9]{${length}}$`, "i").test(stored)) continue;
		if ((await outer(await inner(password))) === storedLower) return true;
	}
	return false;
}

/**
 * Legacy salted digests where the salt is embedded in the stored value using a
 * non-hex separator: `<hash>:<salt>`, `<salt>:<hash>`, `<hash>$<salt>`,
 * `<salt>$<hash>` (also supports `@` and `_`). Every digest family (md5, sha1,
 * sha256, sha512) is tried, and both md5(salt+password) and md5(password+salt)
 * orderings are verified to cover both conventions.
 */
const SALTED_HASH_DELIMITER_RE = /[:$@_]/;

export async function isSaltedDigestOf(
	password: string,
	stored: string,
): Promise<boolean> {
	if (!SALTED_HASH_DELIMITER_RE.test(stored)) return false;

	for (const { length, hash: hashFn } of DIGEST_SCHEMES) {
		const hashFirst = stored.match(
			new RegExp(`^([a-f0-9]{${length}})[:$@_](.{1,64})$`, "i"),
		);
		const saltFirst = stored.match(
			new RegExp(`^(.{1,64})[:$@_]([a-f0-9]{${length}})$`, "i"),
		);
		const hashHex = hashFirst?.[1] ?? saltFirst?.[2];
		const salt = hashFirst?.[2] ?? saltFirst?.[1];
		if (!hashHex || !salt || salt.length > 64) continue;

		const hashLower = hashHex.toLowerCase();
		for (const candidate of [salt + password, password + salt]) {
			if ((await hashFn(candidate)).toLowerCase() === hashLower) return true;
		}
	}
	return false;
}

/**
 * Legacy argon2 verification (argon2id / argon2i / argon2d) — kept ONLY so
 * accounts hashed before the bcrypt switch can still sign in once and be
 * migrated to bcrypt. No new argon2 hashes are ever produced.
 */
export async function isArgon2Of(
	password: string,
	stored: string,
): Promise<boolean> {
	if (!/^\$argon2(id|i|d)?\$/.test(stored)) return false;
	try {
		return await argon2Verify({ password, hash: stored });
	} catch {
		return false;
	}
}

export async function isBcryptOf(
	password: string,
	stored: string,
): Promise<boolean> {
	if (!/^\$2[aby]\$/.test(stored)) return false;
	try {
		return await bcryptVerify({ password, hash: stored });
	} catch {
		return false;
	}
}

export async function verifyPassword(
	password: string,
	stored: string,
): Promise<boolean> {
	if (/^\$argon2/.test(stored)) return isArgon2Of(password, stored);
	return isBcryptOf(password, stored);
}

export interface LoginCheck {
	valid: boolean;
	upgradedHash?: string;
}

/**
 * Verifies a password against a stored hash, supporting every format used by
 * old and current Habbo retro CMS/emulator stacks:
 * - bcrypt ($2a/$2b/$2y): direct verification
 * - argon2id/argon2i/argon2d: verify + auto-upgrade to bcrypt
 * - md5 / sha1 / sha256 / sha512 (unsalted hex): verify + auto-upgrade
 * - combined digests (md5(md5(pass)), sha1(md5(pass)), double sha256, ...): verify
 * - salted digests with embedded salt (hash:salt, salt:hash, hash$salt, ...): verify
 * - plaintext (final fallback): compare + auto-upgrade
 *
 * All legacy formats are automatically rewritten to bcrypt on success.
 */
export async function checkLogin(
	password: string,
	stored: string,
): Promise<LoginCheck> {
	if (!stored) return { valid: false };

	// Legacy argon2 — verify so existing users can sign in, then immediately
	// rehash to bcrypt so the hash format converges on bcrypt.
	if (/^\$argon2/.test(stored)) {
		if (await isArgon2Of(password, stored)) {
			return { valid: true, upgradedHash: await hashPassword(password) };
		}
		return { valid: false };
	}

	if (/^\$2[aby]\$/.test(stored)) {
		return { valid: await isBcryptOf(password, stored) };
	}

	// Legacy digest formats (hex) — verify + auto-upgrade to bcrypt.
	for (const { length, hash: hashFn } of DIGEST_SCHEMES) {
		if (await isHexDigestOf(password, stored, length, hashFn)) {
			return { valid: true, upgradedHash: await hashPassword(password) };
		}
	}

	// Legacy combined / salted digest conventions — verify + auto-upgrade.
	if (
		(await isCombinedDigestOf(password, stored)) ||
		(await isSaltedDigestOf(password, stored))
	) {
		return { valid: true, upgradedHash: await hashPassword(password) };
	}

	// Final fallback: a raw plaintext password stored by very old CMSes.
	// Guard against junk/empty values so only a real exact match succeeds.
	if (stored.length >= 4) {
		if (
			typeof password === "string" &&
			password.length >= 4 &&
			password === stored
		) {
			return { valid: true, upgradedHash: await hashPassword(password) };
		}
	}

	return { valid: false };
}
