"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Read-only copy box for an embed snippet. Renders the code inside a
 * <textarea readOnly> so staff can select/copy it, plus a one-click copy
 * button (with clipboard fallback to selecting the text).
 */
export function EmbedSnippet({
	title,
	description,
	snippet,
}: {
	title: string;
	description?: string;
	snippet: string;
}) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(snippet);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard API unavailable (e.g. insecure context) — fall back to
			// selecting the textarea so the user can copy manually.
			const el = document.getElementById(
				`snippet-${title.replace(/\s+/g, "-").toLowerCase()}`,
			) as HTMLTextAreaElement | null;
			el?.select();
		}
	}

	const id = `snippet-${title.replace(/\s+/g, "-").toLowerCase()}`;
	const lines = snippet.split("\n").length;

	return (
		<section className="mt-6">
			<div className="flex items-center justify-between gap-4 mb-1">
				<h2 className="m-0 text-base font-bold text-[var(--admin-text)]">
					{title}
				</h2>
				<Button type="button" variant="default" onClick={copy}>
					{copied ? "Copied!" : "Copy"}
				</Button>
			</div>
			{description ? (
				<p className="text-xs theme-text-muted dark:theme-text-muted mb-3">
					{description}
				</p>
			) : null}
			<textarea
				id={id}
				readOnly
				value={snippet}
				rows={Math.min(Math.max(lines + 1, 3), 14)}
				onFocus={(e) => e.currentTarget.select()}
				spellCheck={false}
				className="w-full font-mono text-sm resize-vertical"
			/>
		</section>
	);
}
