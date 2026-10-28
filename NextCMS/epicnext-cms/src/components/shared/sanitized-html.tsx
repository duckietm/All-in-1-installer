import type { CSSProperties } from "react";
import { sanitize } from "@/lib/sanitize";

interface SanitizedHtmlProps {
	html: string;
	className?: string;
	style?: CSSProperties;
}

/**
 * Sanitizing parses the HTML with jsdom, which is slow for long articles: the result is kept per
 * input (the same article is rendered for every visitor), for the most recent entries only.
 */
const MAX_CACHED = 200;
const sanitizedCache = new Map<string, string>();

function sanitizeCached(html: string): string {
	const hit = sanitizedCache.get(html);
	if (hit !== undefined) {
		// Most recently used last, so the oldest entry is the one dropped.
		sanitizedCache.delete(html);
		sanitizedCache.set(html, hit);
		return hit;
	}
	const clean = sanitize(html);
	sanitizedCache.set(html, clean);
	if (sanitizedCache.size > MAX_CACHED) {
		const oldest = sanitizedCache.keys().next().value;
		if (oldest !== undefined) sanitizedCache.delete(oldest);
	}
	return clean;
}

/** Sanitizes the HTML itself: pass the raw value, not an already sanitized one. */
export function SanitizedHtml({ html, className, style }: SanitizedHtmlProps) {
	return (
		<div
			className={className}
			style={style}
			dangerouslySetInnerHTML={{ __html: sanitizeCached(html) }}
		/>
	);
}
