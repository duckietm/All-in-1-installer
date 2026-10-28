import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypter using AES-256-GCM.
 *
 * Payload format: base64( JSON {
 *   iv:    base64(12-byte IV),
 *   value: base64(AES-256-GCM ciphertext, itself base64 in the json),
 *   tag:   base64(16-byte authentication tag),
 * } )
 */
export class LaravelEncrypter {
	private readonly key: Buffer;

	/** APP_KEY is "base64:...." (or a raw 32-byte string). */
	constructor(appKey: string) {
		const raw = appKey.startsWith("base64:")
			? Buffer.from(appKey.slice("base64:".length), "base64")
			: Buffer.from(appKey, "utf8");
		if (raw.length !== 32) {
			throw new Error(
				`APP_KEY must decode to 32 bytes for AES-256-GCM (got ${raw.length})`,
			);
		}
		this.key = raw;
	}

	encrypt(value: string, serialize = true): string {
		const iv = randomBytes(12);
		const data = serialize ? phpSerializeString(value) : value;
		const cipher = createCipheriv("aes-256-gcm", this.key, iv);
		const valueB64 =
			cipher.update(data, "utf8", "base64") + cipher.final("base64");
		const tag = cipher.getAuthTag();
		const ivB64 = iv.toString("base64");
		const tagB64 = tag.toString("base64");
		const payload = JSON.stringify({ iv: ivB64, value: valueB64, tag: tagB64 });
		return Buffer.from(payload, "utf8").toString("base64");
	}

	decrypt(payload: string, serialize = true): string {
		const json = JSON.parse(
			Buffer.from(payload, "base64").toString("utf8"),
		) as {
			iv: string;
			value: string;
			tag: string;
		};
		const iv = Buffer.from(json.iv, "base64");
		const tag = Buffer.from(json.tag, "base64");
		const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
		decipher.setAuthTag(tag);
		const plain =
			decipher.update(json.value, "base64", "utf8") + decipher.final("utf8");
		return serialize ? phpUnserializeString(plain) : plain;
	}

	encryptString(value: string): string {
		return this.encrypt(value, false);
	}

	decryptString(payload: string): string {
		return this.decrypt(payload, false);
	}
}

/** PHP serialize() for a string: s:<byteLength>:"<value>"; */
export function phpSerializeString(value: string): string {
	return `s:${Buffer.byteLength(value, "utf8")}:"${value}";`;
}

/** PHP unserialize() for a serialized string payload. */
export function phpUnserializeString(serialized: string): string {
	const m = /^s:(\d+):"/.exec(serialized);
	if (!m) throw new Error("Not a serialized PHP string");
	const byteLen = Number(m[1]);
	const start = m[0].length;
	// Slice by BYTE length (PHP counts bytes), then back to a JS string.
	const bytes = Buffer.from(serialized, "utf8").subarray(
		Buffer.byteLength(serialized.slice(0, start), "utf8"),
	);
	return bytes.subarray(0, byteLen).toString("utf8");
}
