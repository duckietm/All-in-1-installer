import "server-only";
import sharp from "sharp";

const MAX_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const FORMATS = new Map([
	["image/png", "png"],
	["image/jpeg", "jpeg"],
	["image/gif", "gif"],
	["image/webp", "webp"],
	["image/x-icon", "ico"],
	["image/vnd.microsoft.icon", "ico"],
]);

type ValidatedUpload =
	| { success: true; bytes: Buffer; extension: string }
	| { success: false; error: string };

async function validRaster(bytes: Buffer, format: string) {
	const signatureMatches =
		(format === "png" && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) ||
		(format === "jpeg" &&
			bytes[0] === 0xff &&
			bytes[1] === 0xd8 &&
			bytes[2] === 0xff) ||
		(format === "gif" &&
			["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) ||
		(format === "webp" &&
			bytes.toString("ascii", 0, 4) === "RIFF" &&
			bytes.toString("ascii", 8, 12) === "WEBP");
	if (!signatureMatches) return false;
	const image = sharp(bytes, {
		failOn: "warning",
		limitInputPixels: 16 * 1024 * 1024,
		animated: true,
	});
	const metadata = await image.metadata();
	if (metadata.format !== format) return false;
	await image.stats();
	return true;
}

async function validIcon(bytes: Buffer) {
	if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x00010000) return false;
	const count = bytes.readUInt16LE(4);
	const directoryEnd = 6 + count * 16;
	if (!count || directoryEnd > bytes.length) return false;
	for (let i = 0; i < count; i++) {
		const entry = 6 + i * 16;
		const length = bytes.readUInt32LE(entry + 8);
		const offset = bytes.readUInt32LE(entry + 12);
		if (offset < directoryEnd || length < 12 || offset + length > bytes.length)
			return false;
		const frame = bytes.subarray(offset, offset + length);
		if (frame.subarray(0, 8).equals(PNG_SIGNATURE)) {
			if (!(await validRaster(frame, "png"))) return false;
			continue;
		}
		// Classic ICO frames contain a DIB header rather than a standalone BMP.
		const headerSize = frame.readUInt32LE(0);
		if (
			![12, 40, 52, 56, 108, 124].includes(headerSize) ||
			length <= headerSize
		)
			return false;
		const width = bytes[entry] || 256;
		const height = bytes[entry + 1] || 256;
		const core = headerSize === 12;
		if (
			(core ? frame.readUInt16LE(4) : frame.readInt32LE(4)) !== width ||
			(core ? frame.readUInt16LE(6) : frame.readInt32LE(8)) !== height * 2 ||
			frame.readUInt16LE(core ? 8 : 12) !== 1 ||
			![1, 4, 8, 16, 24, 32].includes(frame.readUInt16LE(core ? 10 : 14))
		)
			return false;
	}
	return true;
}

export async function validateSiteImageUpload(
	value: unknown,
	{ allowIcon = false }: { allowIcon?: boolean } = {},
): Promise<ValidatedUpload> {
	if (!(value instanceof File) || value.size === 0)
		return { success: false, error: "No file provided" };
	if (value.size > MAX_BYTES)
		return { success: false, error: "File too large (max 2MB)" };
	const format = FORMATS.get(value.type);
	if (!format || (format === "ico" && !allowIcon))
		return { success: false, error: "Unsupported image type" };
	try {
		const bytes = Buffer.from(await value.arrayBuffer());
		const valid =
			format === "ico"
				? await validIcon(bytes)
				: await validRaster(bytes, format);
		if (!valid) return { success: false, error: "Invalid image file" };
		return {
			success: true,
			bytes,
			extension: format === "jpeg" ? "jpg" : format,
		};
	} catch {
		return { success: false, error: "Invalid image file" };
	}
}
