export interface ArticleRequest {
	signature: string;
	key: string;
}
/** Retain only a fingerprint and request ID, never editorial content. */
export async function articleRequest(
	form: FormData,
	scope: string,
	previous?: ArticleRequest,
	storage?: Pick<Storage, "getItem" | "setItem">,
): Promise<ArticleRequest> {
	const entries = [...form.entries()]
		.filter(([key]) => key !== "requestKey")
		.sort(([a], [b]) => a.localeCompare(b));
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(JSON.stringify([scope, entries])),
	);
	const signature = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	const storageKey = `cms:news:request:${scope}`;
	let saved = previous;
	if (!saved) {
		try {
			saved = JSON.parse(storage?.getItem(storageKey) ?? "null") ?? undefined;
		} catch {
			/* Storage may be disabled. */
		}
	}
	if (
		saved?.signature === signature &&
		/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
			saved.key,
		)
	)
		return saved;
	const next = { signature, key: crypto.randomUUID() };
	try {
		storage?.setItem(storageKey, JSON.stringify(next));
	} catch {
		/* The editor retains the key in memory. */
	}
	return next;
}
