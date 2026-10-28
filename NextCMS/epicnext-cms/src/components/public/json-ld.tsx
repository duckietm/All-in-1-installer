/**
 * Renders schema.org JSON-LD. The payload is data, not executable script, but
 * `<` is escaped so an article title can never terminate the tag early.
 */
export function JsonLd({
	data,
	nonce,
}: {
	data: Record<string, unknown> | Record<string, unknown>[];
	nonce?: string;
}) {
	return (
		<script
			type="application/ld+json"
			nonce={nonce}
			dangerouslySetInnerHTML={{
				__html: JSON.stringify(data).replace(/</g, "\\u003c"),
			}}
		/>
	);
}
