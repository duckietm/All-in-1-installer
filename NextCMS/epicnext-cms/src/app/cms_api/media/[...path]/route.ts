import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { MEDIA_ROOT, resolveMediaPath } from "@/lib/media-storage";

const ALLOWED_EXT = [
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".svg",
	".bmp",
	".ico",
];

const SECURITY_HEADERS = {
	"Content-Security-Policy": "default-src 'none'; sandbox",
	"X-Content-Type-Options": "nosniff",
};

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ path: string[] }> },
) {
	try {
		const { path: segments } = await params;
		const name = segments.join("/");
		// Prevent path traversal
		if (name.includes("..") || name.includes("\\")) {
			return new NextResponse("Forbidden", {
				status: 403,
				headers: SECURITY_HEADERS,
			});
		}
		const ext = path.extname(name).toLowerCase();
		if (!ALLOWED_EXT.includes(ext)) {
			return new NextResponse("Forbidden", {
				status: 403,
				headers: SECURITY_HEADERS,
			});
		}

		const baseDir = MEDIA_ROOT;
		const filePath = resolveMediaPath(name);
		if (!filePath.startsWith(baseDir + path.sep)) {
			return new NextResponse("Forbidden", {
				status: 403,
				headers: SECURITY_HEADERS,
			});
		}
		if (!existsSync(filePath)) {
			return new NextResponse("Not found", {
				status: 404,
				headers: SECURITY_HEADERS,
			});
		}

		const bytes = await readFile(filePath);
		const mime: Record<string, string> = {
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".gif": "image/gif",
			".webp": "image/webp",
			".svg": "image/svg+xml",
			".bmp": "image/bmp",
			".ico": "image/x-icon",
		};

		return new NextResponse(bytes, {
			headers: {
				...SECURITY_HEADERS,
				...(ext === ".svg" ? { "Content-Disposition": "attachment" } : {}),
				// ext validated against ALLOWED_EXT
				"Content-Type": mime[ext] ?? "application/octet-stream",
				"Cache-Control": "public, max-age=3600, must-revalidate",
			},
		});
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		)
			return new NextResponse("Not found", {
				status: 404,
				headers: SECURITY_HEADERS,
			});
		logger.error("Media read failed", { module: "media" });
		return new NextResponse("Could not load media", {
			status: 500,
			headers: SECURITY_HEADERS,
		});
	}
}
