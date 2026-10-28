import { promises as fs } from "node:fs";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { stripBundleExt } from "@/lib/furni/bundle-file";
import { getFurniAssetDirs } from "@/lib/services/furni-asset-dirs";

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, OPTIONS",
};

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ path: string[] }> },
) {
	const segments = (await params).path;
	const filename = segments.at(-1);
	if (
		!filename ||
		filename !== path.basename(filename) ||
		stripBundleExt(filename) === null
	) {
		return new NextResponse(null, { status: 404, headers: CORS_HEADERS });
	}
	try {
		const { nitroDir } = await getFurniAssetDirs();
		const file = await fs.readFile(path.join(nitroDir, filename));
		return new NextResponse(file, {
			headers: {
				...CORS_HEADERS,
				"Content-Type": "application/octet-stream",
				"Cache-Control": "public, max-age=86400, immutable",
			},
		});
	} catch {
		return new NextResponse(null, { status: 404, headers: CORS_HEADERS });
	}
}

export function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
