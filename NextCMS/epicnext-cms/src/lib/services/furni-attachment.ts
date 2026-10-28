import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
	detectNitroTextureFormat,
	parseNitroBundle,
} from "@/lib/services/swf/nitro-builder";
import { importRoot, validJobId } from "./furni-job-store";
export function validateFurnitureAttachment(buffer: Buffer, classname: string) {
	if (buffer.length > 50 * 1024 * 1024)
		throw Error("Maximum file size is 50 MB");
	const parsed = parseNitroBundle(buffer, {
		maxOutputLength: 50 * 1024 * 1024,
	});
	const base = classname.split("*")[0];
	if (
		parsed.jsonFileName !== `${base}.json` ||
		(parsed.json.name && parsed.json.name !== base)
	)
		throw Error(`This bundle does not belong to ${classname}`);
	// The renderer reads WebP Lossless and PNG; parseNitroBundle already
	// rejects anything else, so this only names the format in the error.
	const format = detectNitroTextureFormat(parsed.texture);
	if (!format)
		throw Error("The bundle texture is neither a PNG nor a WebP image");
	return buffer;
}
export async function stageFurnitureAttachment(
	buffer: Buffer,
	classname: string,
	userId: number,
) {
	validateFurnitureAttachment(buffer, classname);
	const id = randomUUID(),
		root = path.join(importRoot(), "attachments");
	await fs.mkdir(root, { recursive: true });
	await fs.writeFile(path.join(root, `${id}.nitro`), buffer);
	await fs.writeFile(
		path.join(root, `${id}.json`),
		JSON.stringify({ classname, userId }),
	);
	return id;
}
export async function readFurnitureAttachment(
	id: string,
	classname: string,
	userId: number,
) {
	if (!validJobId(id)) throw Error("Invalid attachment");
	const root = path.join(importRoot(), "attachments");
	const meta = JSON.parse(
		await fs.readFile(path.join(root, `${id}.json`), "utf8"),
	);
	if (meta.userId !== userId || meta.classname !== classname)
		throw Error("Attachment does not belong to this furniture import");
	return validateFurnitureAttachment(
		await fs.readFile(path.join(root, `${id}.nitro`)),
		classname,
	);
}
