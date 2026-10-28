import { deflateSync } from "node:zlib";
import { initWasmSync, compress as lzmaCompress } from "lzma-wasm";
import { describe, expect, it } from "vitest";
import {
	decompressSwf,
	parseBinaryData,
	parseSwfTags,
	parseSymbolClass,
	TAG_DEFINE_BINARY_DATA,
	TAG_DEFINE_BITS_LOSSLESS,
	TAG_END,
} from "./swf-parser";

const BODY = Buffer.from(
	"uncompressed swf body used for decompression fixtures, padded to a reasonable length",
);

function fwsHeader(payload: Buffer, version = 6): Buffer {
	const header = Buffer.alloc(8);
	header.write("FWS", 0, "ascii");
	header.writeUInt8(version, 3);
	header.writeUInt32LE(payload.length + 8, 4);
	return Buffer.concat([header, payload]);
}

function cwsFixture(payload: Buffer, version = 6): Buffer {
	const header = Buffer.alloc(8);
	header.write("CWS", 0, "ascii");
	header.writeUInt8(version, 3);
	header.writeUInt32LE(payload.length + 8, 4);
	const compressed = deflateSync(payload);
	return Buffer.concat([header, compressed]);
}

function zwsFixture(payload: Buffer, version = 6): Buffer {
	initWasmSync();
	const rawLzma = Buffer.from(
		lzmaCompress(payload, { format: "lzma", level: 9 }),
	);
	const props = Buffer.from(rawLzma.slice(0, 5));
	const compressedPayload = Buffer.from(rawLzma.slice(13));
	const compressedSize = 5 + compressedPayload.length;
	const header = Buffer.alloc(12);
	header.write("ZWS", 0, "ascii");
	header.writeUInt8(version, 3);
	header.writeUInt32LE(payload.length + 8, 4);
	header.writeUInt32LE(compressedSize, 8);
	return Buffer.concat([header, props, compressedPayload]);
}

describe("decompressSwf", () => {
	it("returns FWS buffers untouched", () => {
		const fws = fwsHeader(BODY);
		expect(decompressSwf(fws)).toBe(fws);
	});

	it("inflates CWS (zlib) buffers and restores the FWS signature", () => {
		const result = decompressSwf(cwsFixture(BODY));
		expect(result.toString("ascii", 0, 3)).toBe("FWS");
		expect(result.length).toBe(BODY.length + 8);
		expect(result.subarray(8).equals(BODY)).toBe(true);
	});

	it("decompresses ZWS (lzma) buffers and restores the FWS signature", () => {
		const result = decompressSwf(zwsFixture(BODY));
		expect(result.toString("ascii", 0, 3)).toBe("FWS");
		expect(result.length).toBe(BODY.length + 8);
		expect(result.subarray(8).equals(BODY)).toBe(true);
	});

	it("throws on unknown signatures", () => {
		const bad = Buffer.alloc(16);
		bad.write("XYZ", 0, "ascii");
		expect(() => decompressSwf(bad)).toThrow("Unknown SWF signature");
	});
});

function shortTag(tagType: number, data: Buffer): Buffer {
	expect(data.length).toBeLessThan(0x3f);
	const tag = Buffer.alloc(2 + data.length);
	tag.writeUInt16LE((tagType << 6) | data.length, 0);
	data.copy(tag, 2);
	return tag;
}

function swfWithTags(tags: Buffer[]): Buffer {
	const tagStream = Buffer.concat([...tags, Buffer.from([0, 0])]);
	const body = Buffer.alloc(13);
	body.write("FWS", 0, "ascii");
	body.writeUInt8(6, 3);
	body.writeUInt32LE(tagStream.length + 13, 4);
	return Buffer.concat([body, tagStream]);
}

describe("parseSwfTags", () => {
	it("parses short-form tags until the end marker", () => {
		const swf = swfWithTags([
			shortTag(TAG_DEFINE_BITS_LOSSLESS, Buffer.from([1, 2, 3])),
			shortTag(TAG_DEFINE_BINARY_DATA, Buffer.from([9, 9, 9])),
		]);
		const tags = parseSwfTags(swf);
		expect(tags).toHaveLength(2);
		expect(tags[0].type).toBe(TAG_DEFINE_BITS_LOSSLESS);
		expect(tags[0].data.equals(Buffer.from([1, 2, 3]))).toBe(true);
		expect(tags[1].type).toBe(TAG_DEFINE_BINARY_DATA);
	});

	it("stops at TAG_END and ignores trailing bytes", () => {
		const swf = swfWithTags([
			shortTag(TAG_DEFINE_BITS_LOSSLESS, Buffer.from([1])),
		]);
		expect(parseSwfTags(swf)).toHaveLength(1);
	});

	it("returns an empty array for an empty tag stream", () => {
		const empty = Buffer.alloc(13);
		empty.write("FWS", 0, "ascii");
		expect(parseSwfTags(empty)).toEqual([]);
		expect(TAG_END).toBe(0);
	});
});

describe("parseSymbolClass", () => {
	it("maps char ids to names and tracks aliases", () => {
		const data = Buffer.concat([
			Buffer.from([2, 0]),
			Buffer.from([1, 0]),
			Buffer.from("chair\0", "utf8"),
			Buffer.from([2, 0]),
			Buffer.from("table\0", "utf8"),
		]);
		const result = parseSymbolClass(data);
		expect(result.classNames.get(1)).toBe("chair");
		expect(result.classNames.get(2)).toBe("table");
		expect(result.symbols.get("chair")).toBe(1);
		expect(result.symbols.get("table")).toBe(2);
	});

	it("keeps the first name for a repeated char id", () => {
		const data = Buffer.concat([
			Buffer.from([2, 0]),
			Buffer.from([1, 0]),
			Buffer.from("chair\0", "utf8"),
			Buffer.from([1, 0]),
			Buffer.from("lounge_chair\0", "utf8"),
		]);
		const result = parseSymbolClass(data);
		expect(result.classNames.get(1)).toBe("chair");
		expect(result.symbols.get("lounge_chair")).toBe(1);
	});
});

describe("parseBinaryData", () => {
	it("reads the char id and strips the 6-byte attribute header", () => {
		const data = Buffer.concat([
			Buffer.from([42, 0]),
			Buffer.from([1, 2, 3, 4]),
			Buffer.from("binary payload"),
		]);
		const result = parseBinaryData(data);
		expect(result.id).toBe(42);
		expect(result.content.equals(Buffer.from("binary payload"))).toBe(true);
	});
});
