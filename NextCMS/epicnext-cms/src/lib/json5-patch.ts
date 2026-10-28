// Surgical line-level update for JSON5 files that preserves comments and
// formatting. Used by saveClientTranslations so that the Nitro localization
// files keep their headers and section markers when an admin edits a value.
//
// Assumptions (true for every Nitro `.json5` file in the repo):
//   * one entry per line, formatted as `<key>: <value>,`
//   * keys are simple strings (single- or double-quoted, or bare)
//   * values are strings (single- or double-quoted)
// If a changed key cannot be located via this contract, we report it back so
// the caller can decide whether to fall back to a full re-serialization.

export interface PatchResult {
	/** The new file content, with surgical edits applied. */
	content: string;
	/** Keys that we could not patch surgically (missing or unusual format). */
	unpatchedKeys: string[];
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeForQuote(value: string, quote: '"' | "'"): string {
	// Escape backslashes first, then the chosen quote. Newlines/tabs are
	// preserved as escape sequences so we don't break the JSON5 parser.
	let out = value.replace(/\\/g, "\\\\");
	out = out.replace(new RegExp(quote, "g"), `\\${quote}`);
	out = out.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
	return out;
}

/**
 * Apply per-key value updates to a JSON5 source string while preserving
 * comments and formatting. Only keys present in `original` (and with a
 * different value in `updated`) are touched.
 */
export function patchJson5(
	raw: string,
	original: Record<string, string>,
	updated: Record<string, string>,
): PatchResult {
	let result = raw;
	const unpatchedKeys: string[] = [];

	for (const [key, newVal] of Object.entries(updated)) {
		if (!(key in original)) {
			// Key did not exist on disk — append/merge logic is the caller's job.
			unpatchedKeys.push(key);
			continue;
		}
		if (original[key] === newVal) continue;

		const keyPattern = `(['"]?)${escapeRegExp(key)}\\1\\s*:\\s*(["'])((?:\\\\.|(?!\\2).)*)\\2`;
		const re = new RegExp(keyPattern);
		const idx = result.search(re);
		if (idx < 0) {
			unpatchedKeys.push(key);
			continue;
		}
		const match = re.exec(result);
		if (!match) {
			unpatchedKeys.push(key);
			continue;
		}

		const valueQuote = match[2] as '"' | "'";
		const oldValueLen = match[3].length;
		const fullLen = match[0].length;
		// prefix keeps everything up to and including the opening value quote
		const prefix = match[0].slice(0, fullLen - oldValueLen - 1);
		const escaped = escapeForQuote(newVal, valueQuote);
		const replacement = prefix + escaped + valueQuote;

		result = result.slice(0, idx) + replacement + result.slice(idx + fullLen);
	}

	return { content: result, unpatchedKeys };
}
