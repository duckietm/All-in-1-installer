import type {
	AssetAvailability,
	SourceAssetAttempt,
	SourceAssetCheck,
	SourceAssetItem,
} from "@/lib/furni/source-assets";
import type { CloneSource } from "./clone-sources";
import { browserHeaders } from "./import/core/browser-headers";

const cache = new Map<
	string,
	{ expires: number; attempt: SourceAssetAttempt }
>();
/** Only expose the address path; credentials, signed queries and fragments stay server-side. */
export function diagnosticAssetUrl(raw: string): string {
	const url = new URL(raw);
	return `${url.protocol}//${url.host}${url.pathname}`;
}
async function probeAssetAttempt(url: string): Promise<SourceAssetAttempt> {
	const cached = cache.get(url);
	if (cached && cached.expires > Date.now()) return cached.attempt;
	const safeUrl = diagnosticAssetUrl(url);
	const attempt: SourceAssetAttempt = {
		url: safeUrl,
		file: new URL(url).pathname.split("/").pop() || "",
		state: "unknown",
		reason: "network",
	};
	try {
		const response = await fetch(url, {
			method: "HEAD",
			signal: AbortSignal.timeout(6000),
			headers: browserHeaders(),
		});
		attempt.status = response.status;
		if (
			response.ok &&
			!response.headers.get("content-type")?.includes("text/html")
		) {
			attempt.state = "available";
			attempt.reason = "available";
		} else if (response.ok) attempt.reason = "invalidResponse";
		else {
			attempt.reason = "http";
			if (response.status === 404 || response.status === 410)
				attempt.state = "missing";
		}
	} catch (error) {
		attempt.reason =
			error instanceof Error &&
			(error.name === "TimeoutError" || error.name === "AbortError")
				? "timeout"
				: "network";
	}
	if (cache.size >= 2000) cache.clear();
	cache.set(url, { expires: Date.now() + 60000, attempt });
	return attempt;
}
export async function probeAsset(url: string): Promise<AssetAvailability> {
	return (await probeAssetAttempt(url)).state;
}
export function furnitureAssetUrls(
	item: SourceAssetItem,
	source?: CloneSource | null,
) {
	const base = encodeURIComponent(item.classname.split("*")[0]);
	const urls: string[] = [];
	if (source?.nitroBaseUrl)
		urls.push(`${source.nitroBaseUrl.replace(/\/+$/, "")}/${base}.nitro`);
	if (source?.sourceSwfBaseUrl) {
		const root = source.sourceSwfBaseUrl.replace(/\/+$/, "");
		urls.push(
			`${root}/hof_furni/${item.revision}/${base}.swf`,
			`${root}/hof_furni/${base}.swf`,
		);
	}
	urls.push(
		`https://images.habbo.com/dcr/hof_furni/${item.revision}/${base}.swf`,
	);
	return urls;
}
export async function inspectSourceAssets(
	item: SourceAssetItem,
	official: SourceAssetItem[],
	source?: CloneSource | null,
): Promise<SourceAssetCheck> {
	const canonical = official.find(
		(entry) => entry.classname === item.classname,
	);
	const effective = {
		...item,
		revision: item.revision || canonical?.revision || 0,
	};
	const attempts = await Promise.all(
		furnitureAssetUrls(effective, source).map(probeAssetAttempt),
	);
	const state = attempts.some((attempt) => attempt.state === "available")
		? "available"
		: attempts.every((attempt) => attempt.state === "missing")
			? "missing"
			: "unknown";

	return {
		classname: item.classname,
		revision: effective.revision,
		state,
		alternatives: [],
		attempts,
	};
}
