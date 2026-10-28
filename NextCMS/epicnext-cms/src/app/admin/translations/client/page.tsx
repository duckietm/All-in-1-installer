import fs from "node:fs/promises";
import path from "node:path";
import * as JSONC from "jsonc-parser";
import {
	CLIENT_TRANSLATION_FILES,
	getClientTranslationFile,
} from "@/lib/client-translation-files";
import { ClientTranslations } from "./client-translations";

export default async function ClientTranslationsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | undefined>>;
}) {
	const sp = await searchParams;
	const requested = sp.file;
	const file =
		(requested && getClientTranslationFile(requested)) ||
		CLIENT_TRANSLATION_FILES.find((f) => !f.readOnly) ||
		CLIENT_TRANSLATION_FILES[0];

	const entries: Record<string, string> = {};
	let parseError: string | null = null;

	try {
		// file.relPath comes from CLIENT_TRANSLATION_FILES (closed enum) but
		// Turbopack's tracer can't prove that — hint avoids tracing the whole project.
		const raw = await fs.readFile(
			path.join(/*turbopackIgnore: true*/ process.cwd(), file.relPath),
			"utf-8",
		);
		const parsed = file.format === "json5" ? JSONC.parse(raw) : JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			// Nitro localization files are flat: { "key.with.dots": "value" }.
			// Coerce values to strings so the editor can render them in <input>.
			for (const [k, v] of Object.entries(parsed)) {
				entries[k] = v == null ? "" : String(v);
			}
		} else {
			parseError = "File root is not an object.";
		}
	} catch (err) {
		parseError = err instanceof Error ? err.message : "Failed to read file.";
	}

	return (
		<ClientTranslations
			files={CLIENT_TRANSLATION_FILES}
			activeFile={file}
			entries={entries}
			parseError={parseError}
		/>
	);
}
