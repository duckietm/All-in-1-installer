import { type NextRequest, NextResponse } from "next/server";
import { AVATAR_FALLBACK_SRC } from "@/lib/imager";
import { ifNoneMatchSatisfied, strongEtag } from "@/lib/imager-http";
import {
	fetchAvatarImage,
	ImagerUnavailableError,
	parseAvatarQuery,
} from "@/lib/imager-upstream";

// The same neutral silhouette the client fallback uses, served as a real 200
// response when no upstream can render the figure. Images on server-rendered
// pages therefore never show a broken-image glyph; browsers revalidate quickly
// (`no-cache`) and pick up real renders as soon as an upstream recovers.
const PLACEHOLDER_SVG_BYTES = new TextEncoder().encode(
	decodeURIComponent(
		AVATAR_FALLBACK_SRC.slice("data:image/svg+xml;utf8,".length),
	),
);

function cacheControlFor(source: string): string {
	switch (source) {
		case "fallback":
		case "cache-stale":
			// Reuse the render briefly but revalidate the upstream soon. The
			// shared `s-maxage` lets the edge (Cloudflare) hold it for an hour
			// without pinning a degraded fallback in the browser.
			return "public, max-age=300, s-maxage=3600, stale-while-revalidate=3600";
		case "unavailable":
			return "no-cache, max-age=0";
		default:
			// s-maxage=86400 lets the edge cache a day off the origin, matching
			// the sibling /imaging route; the URL already keys per figure.
			return "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";
	}
}

export async function GET(request: NextRequest) {
	const { searchParams } = new URL(request.url);

	const parsed = parseAvatarQuery(searchParams);
	if (!parsed.ok) {
		return NextResponse.json({ error: parsed.message }, { status: 400 });
	}

	try {
		const { body, contentType, source } = await fetchAvatarImage(
			new URL(request.url).origin,
			parsed.params,
		);

		const etag = strongEtag(body);
		const cacheControl = cacheControlFor(source);
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

		return new NextResponse(body as unknown as BodyInit, {
			status: 200,
			headers: {
				"Content-Type": contentType,
				"Content-Length": String(body.length),
				"Cache-Control": cacheControl,
				ETag: etag,
				"X-Imager-Source": source,
				"Access-Control-Allow-Origin": "*",
			},
		});
	} catch (error) {
		if (error instanceof ImagerUnavailableError) {
			const etag = strongEtag(PLACEHOLDER_SVG_BYTES);
			if (ifNoneMatchSatisfied(request.headers.get("if-none-match"), etag)) {
				return new NextResponse(null, {
					status: 304,
					headers: {
						ETag: etag,
						"Cache-Control": cacheControlFor("unavailable"),
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
					"Cache-Control": cacheControlFor("unavailable"),
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
