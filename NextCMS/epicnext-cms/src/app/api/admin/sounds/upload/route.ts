import { promises as fs } from "node:fs";
import { desc, eq } from "drizzle-orm";
import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { db, Soundtracks } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";
import {
	extractMp3Duration,
	getSoundtrackPath,
	isSafeSoundtrackCode,
	MAX_SOUNDTRACK_SIZE,
	validateMp3Bytes,
	writeSoundtrackFile,
} from "@/lib/services/soundtracks";

export const POST = withAdmin(
	{ permission: PERMS.CATALOG_EDIT, requireCsrf: true },
	async (request) => {
		const formData = await request.formData();
		const file = formData.get("file");
		const name = String(formData.get("name") ?? "").trim();
		const author = String(formData.get("author") ?? "").trim();

		if (!(file instanceof File)) {
			return apiError("No file uploaded", 400);
		}
		if (!name) {
			return apiError("Name is required", 400);
		}
		if (file.size > MAX_SOUNDTRACK_SIZE) {
			return apiError("File exceeds 10 MB limit", 413);
		}
		if (file.size === 0) {
			return apiError("File is empty", 400);
		}

		const buf = Buffer.from(await file.arrayBuffer());
		if (!validateMp3Bytes(buf)) {
			return apiError("File is not a valid MP3", 415);
		}

		const duration = await extractMp3Duration(buf);

		const maxRow = await db
			.select({ maxId: Soundtracks.id })
			.from(Soundtracks)
			.orderBy(desc(Soundtracks.id))
			.limit(1)
			.then((rows) => rows[0]?.maxId ?? 0)
			.catch(() => 0);

		const nextId = maxRow + 1;
		const code = `song_${nextId}`;

		if (!isSafeSoundtrackCode(code)) {
			return apiError("Generated code is invalid", 500);
		}

		const existing = await db
			.select({ id: Soundtracks.id })
			.from(Soundtracks)
			.where(eq(Soundtracks.code, code))
			.limit(1)
			.catch(() => null);

		if (existing && existing.length > 0) {
			return apiError("Song code already exists", 409);
		}

		await writeSoundtrackFile(code, buf);

		let id: number;
		try {
			const result = await db.insert(Soundtracks).values({
				code,
				name: name.slice(0, 100),
				author: author.slice(0, 50),
				track: "",
				length: duration,
			});
			id = Number(result[0].insertId);
		} catch (err) {
			logger.error("Failed to insert soundtrack record", { err, code });
			try {
				await fs.unlink(getSoundtrackPath(code));
			} catch {
				/* ignore cleanup failure */
			}
			return apiError("Failed to save soundtrack", 500);
		}

		return apiOk({ ok: true, id, code });
	},
);
