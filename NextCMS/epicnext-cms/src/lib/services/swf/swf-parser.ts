/**
 * Low-level SWF file parsing: decompression, tag reading, symbol class.
 */

import { inflateSync } from "node:zlib";
import { initWasmSync, decompress as lzmaDecompress } from "lzma-wasm";

initWasmSync();

// ── SWF Tag Types ──────────────────────────────────────────────────
export const TAG_END = 0;
export const TAG_DEFINE_BITS_LOSSLESS = 20;
export const TAG_DEFINE_BITS_JPEG2 = 21;
export const TAG_DEFINE_BITS_JPEG3 = 35;
export const TAG_DEFINE_BITS_LOSSLESS2 = 36;
export const TAG_SYMBOL_CLASS = 76;
export const TAG_DEFINE_BINARY_DATA = 87;

// ── Interfaces ─────────────────────────────────────────────────────

export interface SwfTag {
	type: number;
	data: Buffer;
}

export interface SymbolClassResult {
	/** charID → first symbol name (canonical name) */
	classNames: Map<number, string>;
	/** symbol name → charID (all symbols including aliases) */
	symbols: Map<string, number>;
}

// ── SWF Header Parsing ─────────────────────────────────────────────

export function decompressSwf(buffer: Buffer): Buffer {
	const sig = buffer.toString("ascii", 0, 3);

	if (sig === "FWS") {
		return buffer;
	}

	if (sig === "CWS") {
		const header = Buffer.alloc(8);
		buffer.copy(header, 0, 0, 8);
		header.write("FWS", 0, 3, "ascii");
		const compressed = buffer.subarray(8);
		const decompressed = inflateSync(compressed);
		return Buffer.concat([header, decompressed]);
	}

	if (sig === "ZWS") {
		const fileLength = buffer.readUInt32LE(4);
		const compressedSize = buffer.readUInt32LE(8);
		const lzmaData = buffer.subarray(12, 12 + compressedSize);

		const props = lzmaData.subarray(0, 5);
		const compressedPayload = lzmaData.subarray(5);

		const uncompressedSize = fileLength - 8;
		const lzmaHeader = Buffer.alloc(13);
		props.copy(lzmaHeader, 0);
		lzmaHeader.writeUInt32LE(uncompressedSize, 5);
		lzmaHeader.writeUInt32LE(0, 9);

		const lzmaStream = Buffer.concat([lzmaHeader, compressedPayload]);
		const decompressed = Buffer.from(
			lzmaDecompress(lzmaStream, { expectedSize: uncompressedSize }),
		);

		const header = Buffer.alloc(8);
		buffer.copy(header, 0, 0, 8);
		header.write("FWS", 0, 3, "ascii");
		return Buffer.concat([header, decompressed]);
	}

	throw new Error(`Unknown SWF signature: ${sig}`);
}

function readRect(buf: Buffer, offset: number): number {
	const nbits = (buf[offset] >> 3) & 0x1f;
	const totalBits = 5 + nbits * 4;
	const totalBytes = Math.ceil(totalBits / 8);
	return offset + totalBytes;
}

// ── SWF Tag Reader ─────────────────────────────────────────────────

export function parseSwfTags(swfBuffer: Buffer): SwfTag[] {
	const tags: SwfTag[] = [];

	let offset = 8;
	offset = readRect(swfBuffer, offset);
	offset += 4;

	while (offset < swfBuffer.length) {
		if (offset + 2 > swfBuffer.length) break;

		const tagCodeAndLength = swfBuffer.readUInt16LE(offset);
		offset += 2;

		const tagType = (tagCodeAndLength >> 6) & 0x3ff;
		let tagLength = tagCodeAndLength & 0x3f;

		if (tagLength === 0x3f) {
			if (offset + 4 > swfBuffer.length) break;
			tagLength = swfBuffer.readUInt32LE(offset);
			offset += 4;
		}

		if (tagType === TAG_END) break;
		if (offset + tagLength > swfBuffer.length) break;

		const tagData = swfBuffer.subarray(offset, offset + tagLength);
		tags.push({ type: tagType, data: Buffer.from(tagData) });
		offset += tagLength;
	}

	return tags;
}

// ── SymbolClass Parser ─────────────────────────────────────────────

export function parseSymbolClass(data: Buffer): SymbolClassResult {
	const classNames = new Map<number, string>();
	const symbols = new Map<string, number>();
	let offset = 0;

	const numSymbols = data.readUInt16LE(offset);
	offset += 2;

	for (let i = 0; i < numSymbols; i++) {
		if (offset + 2 > data.length) break;
		const charId = data.readUInt16LE(offset);
		offset += 2;

		const strStart = offset;
		while (offset < data.length && data[offset] !== 0) offset++;
		const name = data.toString("utf-8", strStart, offset);
		offset++;

		symbols.set(name, charId);
		if (!classNames.has(charId)) {
			classNames.set(charId, name);
		}
	}

	return { classNames, symbols };
}

// ── DefineBinaryData Parser ────────────────────────────────────────

export function parseBinaryData(data: Buffer): { id: number; content: Buffer } {
	const id = data.readUInt16LE(0);
	const content = data.subarray(6);
	return { id, content };
}
