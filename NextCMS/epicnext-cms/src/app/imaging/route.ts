import { type NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { AVATAR_FALLBACK_SRC } from "@/lib/imager";
import {
	avatarCacheDir,
	imagingCacheKey,
	readImagingCache,
	writeImagingCache,
} from "@/lib/imager-cache";
import { ifNoneMatchSatisfied, strongEtag } from "@/lib/imager-http";
import { isAnimatedPng } from "@/lib/imager-png";
import {
	fetchAvatarImage,
	ImagerUnavailableError,
	parseAvatarQuery,
} from "@/lib/imager-upstream";
import { resolveImagerBase } from "@/lib/runtime-asset-config";

// Site-wide default imager endpoint. NOTE ON TOPOLOGY: in the current
// production deployment the edge proxy (Traefik) fronts bare `/imaging` and
// `/imaging/*` directly to the local pixinode renderer container, so this CMS
// route is shadowed publicly and only answers when the CMS is reached directly
// (local/dev, self-hosted installs without that proxy rule, or the deploy gate).
// That is intentional: it keeps `habbo_imaging_url=/imaging` working without the
// CMS in the hot path, and this route remains the correct fallback for any
// install where no separate imager is proxied. Its behaviour is covered by
// `src/lib/imaging-route.test.ts` and the CMS-only e2e (`e2e/imaging/cms-imaging.spec.ts`).
//
// It differs from the sibling `/cms_api/imaging/avatar` route in that it also
// transcodes PNG renders to WebP/AVIF (`?format=`) and is cached on disk per
// (figure, variant).

type AvatarFormat = "png" | "webp" | "avif";
type TranscodeFormat = Exclude<AvatarFormat, "png">;

// Same neutral silhouette the sibling /cms_api/imaging/avatar route serves, so a
// figure no upstream can render still shows a graceful image instead of the
// browser's broken-image glyph. This is the site-wide default imager endpoint,
// so a 502 here would blank avatars across every server-rendered page.
const PLACEHOLDER_SVG_BYTES = new TextEncoder().encode(
	decodeURIComponent(
		AVATAR_FALLBACK_SRC.slice("data:image/svg+xml;utf8,".length),
	),
);

function resolveFormat(raw: string | null): AvatarFormat {
	switch (raw?.toLowerCase()) {
		case "webp":
			return "webp";
		case "avif":
			return "avif";
		default:
			return "png";
	}
}

/**
 * Concurrent cold-cache requests for the same figure all arrive with the same
 * decoded PNG and the same target format, so they would each run the same
 * sharp transcode — the one operation on this route that is CPU-bound. Sharing
 * a single transcode across those requests keeps a cold cache from stacking
 * identical encoder work. Held on globalThis because Next can evaluate this
 * module more than once per process; separate copies would each start their own
 * transcode and defeat the point.
 */
const globalForTranscodes = globalThis as typeof globalThis & {
	imagingTranscodes?: Map<string, Promise<TranscodeResult | null>>;
};
const inFlight =
	globalForTranscodes.imagingTranscodes ??
	new Map<string, Promise<TranscodeResult | null>>();
globalForTranscodes.imagingTranscodes = inFlight;

interface TranscodeResult {
	body: Uint8Array;
	contentType: string;
}

/**
 * Serve a WebP/AVIF variant of the decoded render, cached on disk so sharp only
 * runs once per (figure, variant) rather than on every avatar request. This
 * endpoint is the default imager, so re-encoding on each hit would burn CPU for
 * an image that never changes.
 *
 * Returns `null` when a conversion cannot be produced (e.g. sharp cannot decode
 * the input) so the caller falls back to serving the original render unchanged.
 */
async function transcodeToVariant(
	body: Uint8Array,
	format: TranscodeFormat,
	variantKey: string,
): Promise<TranscodeResult | null> {
	if (isAnimatedPng(body)) return null;

	const cached = await readImagingCache(avatarCacheDir(), variantKey);
	if (cached) return cached;

	const pending = inFlight.get(variantKey);
	if (pending) return pending;

	const work = runTranscode(body, format, variantKey);
	inFlight.set(variantKey, work);
	try {
		return await work;
	} finally {
		if (inFlight.get(variantKey) === work) inFlight.delete(variantKey);
	}
}

async function runTranscode(
	body: Uint8Array,
	format: TranscodeFormat,
	variantKey: string,
): Promise<TranscodeResult | null> {
	try {
		// `animated: true` lets sharp carry animation through for inputs it can
		// decode frame-by-frame (animated GIF/WebP). APNG is handled before this
		// point: libvips here reads only its first frame, so those are left as-is.
		const pipeline = sharp(Buffer.from(body), { animated: true });
		const out =
			format === "webp"
				? await pipeline.webp().toBuffer()
				: await pipeline.avif().toBuffer();
		const contentType = format === "webp" ? "image/webp" : "image/avif";
		const result = { body: new Uint8Array(out), contentType };
		// Best-effort: a failed write must never turn a good render into an
		// error; the next request simply re-runs the transcode.
		await writeImagingCache(
			avatarCacheDir(),
			variantKey,
			result.body,
			contentType,
		);
		return result;
	} catch {
		return null;
	}
}

export async function GET(request: NextRequest) {
	const { searchParams } = new URL(request.url);

	const parsed = parseAvatarQuery(searchParams);
	if (!parsed.ok) {
		return NextResponse.json({ error: parsed.message }, { status: 400 });
	}

	const format = resolveFormat(searchParams.get("format"));

	try {
		const { body, contentType, source } = await fetchAvatarImage(
			new URL(request.url).origin,
			parsed.params,
		);

		let respBody: Uint8Array = body;
		let respContentType = contentType;
		if (format !== "png") {
			// The variant is keyed off the exact render that produced it (the
			// resolved upstream + the normalized query) plus the target format,
			// mirroring how the underlying render itself is cached.
			const variantKey = imagingCacheKey(
				`${resolveImagerBase(new URL(request.url).origin)}\n${parsed.params.toString()}\n${format}`,
			);
			const converted = await transcodeToVariant(body, format, variantKey);
			if (converted) {
				respBody = converted.body;
				respContentType = converted.contentType;
			}
		}

		const etag = strongEtag(respBody);
		// s-maxage lets Cloudflare/edge cache avatars (currently DYNAMIC),
		// stale-while-revalidate keeps them fresh without blocking requests.
		// The ?format= param is part of the URL, so variants cache separately.
		// Fallback renders use a shorter TTL so the configured imager is
		// retried soon instead of being masked for hours.
		const cacheControl =
			source === "fallback"
				? "public, max-age=300, s-maxage=3600, stale-while-revalidate=3600"
				: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";
		if (ifNoneMatchSatisfied(request.headers.get("if-none-match"), etag)) {
			return new NextResponse(null, {
				status: 304,
				headers: {
					ETag: etag,
					"Cache-Control": cacheControl,
					"X-Imager-Source": source,
					"Access-Control-Allow-Origin": "*",
				},
			});
		}

		return new NextResponse(respBody as unknown as BodyInit, {
			status: 200,
			headers: {
				"Content-Type": respContentType,
				"Content-Length": String(respBody.length),
				"Cache-Control": cacheControl,
				ETag: etag,
				"X-Imager-Source": source,
				"Access-Control-Allow-Origin": "*",
			},
		});
	} catch (error) {
		if (error instanceof ImagerUnavailableError) {
			// Every upstream is down and nothing was cached: serve the graceful
			// silhouette as a 200 so <img> tags never break, and keep it
			// uncached so a real render is picked up as soon as one recovers.
			const etag = strongEtag(PLACEHOLDER_SVG_BYTES);
			if (ifNoneMatchSatisfied(request.headers.get("if-none-match"), etag)) {
				return new NextResponse(null, {
					status: 304,
					headers: {
						ETag: etag,
						"Cache-Control": "no-cache, max-age=0",
						"X-Imager-Source": "unavailable",
						"Access-Control-Allow-Origin": "*",
					},
				});
			}
			return new NextResponse(PLACEHOLDER_SVG_BYTES as unknown as BodyInit, {
				status: 200,
				headers: {
					"Content-Type": "image/svg+xml",
					"Content-Length": String(PLACEHOLDER_SVG_BYTES.length),
					"Cache-Control": "no-cache, max-age=0",
					ETag: etag,
					"X-Imager-Source": "unavailable",
					"Access-Control-Allow-Origin": "*",
				},
			});
		}
		return NextResponse.json(
			{ error: "Failed to fetch avatar from upstream" },
			{ status: 502 },
		);
	}
}

export async function OPTIONS() {
	return new NextResponse(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, If-None-Match",
		},
	});
}
