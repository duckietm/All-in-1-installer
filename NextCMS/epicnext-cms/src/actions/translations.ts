"use server";

import fs from "node:fs/promises";
import path from "node:path";
import * as JSONC from "jsonc-parser";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import {
	CLIENT_TRANSLATION_FILES,
	getClientTranslationFile,
} from "@/lib/client-translation-files";
import {
	CmsTranslationError,
	saveCmsTranslation,
} from "@/lib/cms-translations";
import { patchJson5 } from "@/lib/json5-patch";
import { PERMS } from "@/lib/permissions";
import { adminAction } from "@/lib/safe-action";
import { ActionError, actionOk } from "@/lib/safe-action-shared";

const saveTranslationsSchema = z.object({
	locale: z.enum(SUPPORTED_LOCALES),
	revision: z.string().regex(/^[a-f0-9]{64}$/),
	changes: z
		.record(z.string().max(300), z.string().max(20000).nullable())
		.refine((value) => Object.keys(value).length <= 5000),
});

export const saveTranslations = adminAction(
	{ permission: PERMS.SETTINGS_EDIT, schema: saveTranslationsSchema },
	async (ctx) => {
		try {
			const snapshot = await saveCmsTranslation(
				ctx.data.locale,
				ctx.data.revision,
				ctx.data.changes,
			);
			revalidatePath("/", "layout");
			return actionOk({ snapshot });
		} catch (error) {
			if (!(error instanceof CmsTranslationError)) throw error;
			const t = await getTranslations("pages.admin.translations.cms");
			return { ok: false, error: t(error.code, { key: error.key }) };
		}
	},
);

const saveClientTranslationsSchema = z.object({
	fileId: z.enum(
		CLIENT_TRANSLATION_FILES.map((f) => f.id) as [string, ...string[]],
	),
	data: z.record(z.string(), z.string()),
});

export const saveClientTranslations = adminAction(
	{ permission: PERMS.SETTINGS_EDIT, schema: saveClientTranslationsSchema },
	async (ctx) => {
		const file = getClientTranslationFile(ctx.data.fileId);
		if (!file) throw new ActionError("Unknown file");
		if (file.readOnly) throw new ActionError("File is read-only");

		// file.relPath comes from CLIENT_TRANSLATION_FILES (closed enum) but
		// Turbopack's static tracer can't prove that — without the hint it
		// pulls the entire project into the NFT list.
		const absPath = path.join(
			/*turbopackIgnore: true*/ process.cwd(),
			file.relPath,
		);
		const raw = await fs.readFile(absPath, "utf-8");

		if (file.format === "json") {
			// Plain JSON — no comments to preserve, just round-trip.
			await fs.writeFile(
				absPath,
				JSON.stringify(ctx.data.data, null, 4),
				"utf-8",
			);
			return actionOk({ commentsLost: false, unpatchedKeys: [] as string[] });
		}

		// JSON5: surgical line-level patch keeps headers and section comments
		// intact. Falls back to a full re-serialization (which DOES drop comments)
		// only when an edited key cannot be located via the patch contract.
		const original: Record<string, string> = {};
		const parsed = JSONC.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			for (const [k, v] of Object.entries(parsed)) {
				original[k] = v == null ? "" : String(v);
			}
		}

		const { content, unpatchedKeys } = patchJson5(raw, original, ctx.data.data);

		if (unpatchedKeys.length === 0) {
			await fs.writeFile(absPath, content, "utf-8");
			return actionOk({ commentsLost: false, unpatchedKeys });
		}

		// At least one key could not be patched surgically (e.g. unusual
		// formatting or a brand-new key). Fall back to a full re-serialization
		// and warn the caller that comments were lost.
		await fs.writeFile(
			absPath,
			JSON.stringify(ctx.data.data, null, 4),
			"utf-8",
		);
		return actionOk({ commentsLost: true, unpatchedKeys });
	},
);
