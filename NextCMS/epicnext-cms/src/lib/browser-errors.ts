const seen = new Map<string, { at: number; id: string }>();
export function reportBrowserError(
	error: unknown,
	event = "browser.exception",
) {
	if (typeof window === "undefined") return;
	const candidate =
		error instanceof Error
			? error
			: new Error(typeof error === "string" ? error : "Unknown browser error");
	const key = `${event}:${location.pathname}:${"digest" in candidate ? candidate.digest : ""}:${candidate.message}`;
	const now = Date.now();
	const prior = seen.get(key);
	if (prior && now - prior.at < 60000) return prior.id;
	const reference = crypto.randomUUID();
	if (seen.size >= 100) seen.clear();
	seen.set(key, { at: now, id: reference });
	const digest = "digest" in candidate ? String(candidate.digest) : undefined;
	void fetch("/api/diagnostics/errors", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		keepalive: true,
		body: JSON.stringify({
			event,
			clientReference: reference,
			message: candidate.message.slice(0, 1000),
			stack: candidate.stack?.slice(0, 6000),
			path: location.pathname,
			digest,
			release: process.env.NEXT_PUBLIC_CMS_RELEASE,
		}),
	}).catch(() => {});
	return reference;
}
