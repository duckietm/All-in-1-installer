import type { CSSProperties } from "react";
import { sanitize } from "@/lib/sanitize";

interface SanitizedHtmlProps {
	html: string;
	className?: string;
	style?: CSSProperties;
}

export function SanitizedHtml({ html, className, style }: SanitizedHtmlProps) {
	return (
		<div
			className={className}
			style={style}
			dangerouslySetInnerHTML={{ __html: sanitize(html) }}
		/>
	);
}
