import { env } from "@/env";
import { db, WebsiteWordfilter } from "@/lib/db";

// AtomCMS-faithful content moderation, used by user-generated-content actions
// (article comments, mottos, registration, etc.) before they touch the DB.
//
// Two layers, evaluated in order:
//   1. website_wordfilter — the CMS-owned blocklist (WebsiteWordfilter),
//      mirroring AtomCMS's word filter. Loaded once and cached in-process like
//      site-settings, so the common path never hits the DB.
//   2. OpenAI Moderations — only when OPENAI_API_KEY is set. A flagged result
//      blocks the content.
//
// Philosophy: FAIL-OPEN. A DB outage, a network blip, or an OpenAI error must
// never block a legitimate post — those paths return { ok: true }. We only
// return { ok: false } on a *confirmed* hit (a matched filter word, or an
// explicitly-flagged AI result). Pure server module; uses global fetch only.

export interface ModerationResult {
	ok: boolean;
	reason?: string;
}

const OPENAI_MODERATIONS_URL = "https://api.openai.com/v1/moderations";
// Bound the AI call so a slow/hung endpoint can't stall a server action.
const OPENAI_TIMEOUT_MS = 5_000;

/**
 * In-process cache of the lowercased website_wordfilter words. Auto-refreshes
 * after WORD_FILTER_TTL_MS to pick up admin edits without manual cache bust.
 */
let wordFilterCache: string[] | null = null;
let wordFilterLoadedAt = 0;
const WORD_FILTER_TTL_MS = 60_000;

async function loadWordFilter(): Promise<string[]> {
	const now = Date.now();
	if (
		wordFilterCache === null ||
		now - wordFilterLoadedAt > WORD_FILTER_TTL_MS
	) {
		try {
			const rows = await db
				.select({ word: WebsiteWordfilter.word })
				.from(WebsiteWordfilter);
			wordFilterCache = rows
				.map((r) => r.word.trim().toLowerCase())
				.filter((w) => w.length > 0);
			wordFilterLoadedAt = now;
		} catch {
			// DB unavailable — return an empty filter WITHOUT caching, so the next
			// call retries. Fail-open: a missing blocklist must not block content.
			return [];
		}
	}
	return wordFilterCache;
}

/** Invalidate the cached word filter after the blocklist is edited. */
export function reloadWordFilter(): void {
	wordFilterCache = null;
}

/**
 * Check `text` against the cached website_wordfilter list. Returns the matched
 * word, or null if clean. Substring match on the lowercased text, matching
 * AtomCMS's behaviour (filtered words are blocked even inside other words).
 */
async function wordFilterHit(text: string): Promise<string | null> {
	const words = await loadWordFilter();
	if (words.length === 0) return null;
	const haystack = text.toLowerCase();
	for (const word of words) {
		if (haystack.includes(word)) return word;
	}
	return null;
}

/**
 * Ask the OpenAI Moderations endpoint whether `text` is flagged. Returns true
 * ONLY on a confirmed flag. Any error (no key, network failure, non-2xx,
 * malformed body, timeout) returns false — fail-open.
 */
async function openAiFlagged(text: string): Promise<boolean> {
	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) return false;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
	try {
		const res = await fetch(OPENAI_MODERATIONS_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({ input: text }),
			signal: controller.signal,
			cache: "no-store",
		});
		if (!res.ok) return false;

		const data: unknown = await res.json();
		const results = (data as { results?: Array<{ flagged?: boolean }> })
			?.results;
		if (!Array.isArray(results)) return false;
		return results.some((r) => r?.flagged === true);
	} catch {
		// Network error / abort / parse failure — fail-open.
		return false;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Decide whether `text` is allowed. Resolves to { ok:false, reason } on a
 * confirmed wordfilter or AI hit; otherwise { ok:true }. Never throws — empty
 * or non-string input is treated as allowed (nothing to moderate).
 */
export async function isAllowed(text: string): Promise<ModerationResult> {
	if (typeof text !== "string" || text.trim().length === 0) {
		return { ok: true };
	}

	// Layer 1: local blocklist (cheap, cached).
	const hit = await wordFilterHit(text);
	if (hit) {
		return { ok: false, reason: `Blocked by word filter: "${hit}"` };
	}

	// Layer 2: OpenAI moderation (only when configured).
	if (await openAiFlagged(text)) {
		return { ok: false, reason: "Blocked by automated content moderation" };
	}

	return { ok: true };
}

/**
 * Same check as isAllowed(), but throws an Error with the moderation reason when
 * the content is rejected. Convenient inside server actions that want to bail
 * early. Resolves silently when the content is allowed.
 */
export async function moderateOrThrow(text: string): Promise<void> {
	const result = await isAllowed(text);
	if (!result.ok) {
		throw new Error(result.reason ?? "Content not allowed");
	}
}
