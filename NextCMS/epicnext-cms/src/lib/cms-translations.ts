import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { type AppLocale, isSupportedLocale } from "@/i18n/locales";
import type { MessageTree } from "@/i18n/merge-messages";
import { validateCmsMessage } from "./cms-message-validation";
import { logger } from "./logger";
import {
	withGamedataLock,
	writeGamedataJsonAtomic,
} from "./services/import/core/gamedata-json";
import { flattenObject, unflattenObject } from "./translations-utils";

const defaultRoot = path.join(
	/*turbopackIgnore: true*/ process.cwd(),
	"storage",
	"cms-translations",
);
export interface CmsTranslationSnapshot {
	messages: Record<string, string>;
	revision: string;
}
export class CmsTranslationError extends Error {
	constructor(
		public readonly code:
			| "conflict"
			| "unknownKey"
			| "empty"
			| "invalid"
			| "variables",
		public readonly key = "",
	) {
		super(`${code}: ${key}`);
	}
}
async function bundled(locale: AppLocale): Promise<Record<string, string>> {
	return flattenObject((await import(`../messages/${locale}.json`)).default);
}

/**
 * Flattened catalog per locale. The dynamic import is cached by the module
 * system, but flattening 6 100 keys is not: doing that on every request cost
 * 4–12 ms of CPU per page render.
 */
const flatBundled = new Map<AppLocale, Promise<Record<string, string>>>();
function bundledFlat(locale: AppLocale): Promise<Record<string, string>> {
	let pending = flatBundled.get(locale);
	if (!pending) {
		pending = bundled(locale);
		flatBundled.set(locale, pending);
	}
	return pending;
}

/** Digest of the bundled part of a locale's revision, so only overrides hash. */
const baseDigest = new Map<AppLocale, string>();
async function revisionFor(
	locale: AppLocale,
	overrides: Record<string, string>,
): Promise<string> {
	let digest = baseDigest.get(locale);
	if (!digest) {
		digest = createHash("sha256")
			.update(JSON.stringify(await bundledFlat(locale)))
			.digest("hex");
		baseDigest.set(locale, digest);
	}
	return createHash("sha256")
		.update(digest)
		.update(JSON.stringify(overrides))
		.digest("hex");
}
async function readOverrides(file: string): Promise<Record<string, string>> {
	try {
		const parsed: unknown = JSON.parse(
			await fs.readFile(/*turbopackIgnore: true*/ file, "utf8"),
		);
		if (
			!parsed ||
			typeof parsed !== "object" ||
			Array.isArray(parsed) ||
			Object.values(parsed).some((v) => typeof v !== "string")
		)
			throw new Error("Invalid CMS translation override file");
		return parsed as Record<string, string>;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}
function localeFile(locale: AppLocale, root: string) {
	if (!isSupportedLocale(locale)) throw new Error("Unsupported locale");
	return path.join(root, `${locale}.json`);
}
export async function readCmsTranslation(
	locale: AppLocale,
	root = defaultRoot,
): Promise<CmsTranslationSnapshot> {
	const [base, source, overrides] = await Promise.all([
		bundledFlat(locale),
		bundledFlat("en"),
		readOverrides(localeFile(locale, root)),
	]);
	const messages = { ...base };
	for (const [key, value] of Object.entries(overrides)) {
		// Obsolete or incompatible overrides must not break new releases.
		if (!Object.hasOwn(source, key) || validateCmsMessage(value, source[key]))
			continue;
		messages[key] = value;
	}
	return {
		messages,
		revision: await revisionFor(locale, overrides),
	};
}
export async function saveCmsTranslation(
	locale: AppLocale,
	revision: string,
	changes: Record<string, string | null>,
	root = defaultRoot,
): Promise<CmsTranslationSnapshot> {
	const file = localeFile(locale, root);
	await fs.mkdir(root, { recursive: true });
	return withGamedataLock(file, async () => {
		const current = await readCmsTranslation(locale, root);
		if (current.revision !== revision)
			throw new CmsTranslationError("conflict");
		const [base, source, overrides] = await Promise.all([
			bundledFlat(locale),
			bundledFlat("en"),
			readOverrides(file),
		]);
		for (const [key, value] of Object.entries(changes)) {
			if (!Object.hasOwn(source, key))
				throw new CmsTranslationError("unknownKey", key);
			if (value === null || value === base[key]) {
				delete overrides[key];
				continue;
			}
			const issue = validateCmsMessage(value, source[key]);
			if (issue) throw new CmsTranslationError(issue, key);
			overrides[key] = value;
		}
		await writeGamedataJsonAtomic(file, overrides);
		return readCmsTranslation(locale, root);
	});
}
interface MergedMemo {
	locale: AppLocale;
	mtimeMs: number;
	size: number;
	builtAt: number;
	tree: MessageTree;
}

/**
 * Merged tree per locale, reused across requests until the override file
 * changes. Still re-stat'ed (cheap, and at most once per MEMO_TTL_MS) so a
 * runtime translation edit stays visible without a restart.
 */
let mergedMemo: MergedMemo | null = null;
const MEMO_TTL_MS = 2_000;

async function overrideFingerprint(
	locale: AppLocale,
	root: string,
): Promise<{ mtimeMs: number; size: number }> {
	try {
		const stat = await fs.stat(localeFile(locale, root));
		return { mtimeMs: stat.mtimeMs, size: stat.size };
	} catch {
		return { mtimeMs: 0, size: 0 };
	}
}

/** Per-request deduplication plus the cross-request memo above. */
export const loadCmsMessages = cache(
	async (locale: AppLocale): Promise<MessageTree> => {
		const fingerprint = await overrideFingerprint(locale, defaultRoot);
		if (
			mergedMemo &&
			mergedMemo.locale === locale &&
			mergedMemo.mtimeMs === fingerprint.mtimeMs &&
			mergedMemo.size === fingerprint.size &&
			Date.now() - mergedMemo.builtAt < MEMO_TTL_MS
		) {
			return mergedMemo.tree;
		}

		try {
			const tree = unflattenObject(
				(await readCmsTranslation(locale)).messages,
			) as MessageTree;
			mergedMemo = { locale, ...fingerprint, builtAt: Date.now(), tree };
			return tree;
		} catch (error) {
			logger.error("CMS translation overrides could not be loaded", {
				locale,
				error,
			});
			return (await import(`../messages/${locale}.json`)).default;
		}
	},
);
