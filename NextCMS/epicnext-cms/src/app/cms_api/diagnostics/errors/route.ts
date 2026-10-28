import { NextResponse } from "next/server";
import { z } from "zod";
import { createErrorRecord, ErrorStore } from "@/lib/error-monitor";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
	event: z.enum([
		"browser.exception",
		"browser.boundary",
		"browser.unhandled_rejection",
	]),
	clientReference: z.string().uuid().optional(),
	message: z.string().max(1000),
	stack: z.string().max(6000).optional(),
	path: z.string().startsWith("/").max(1000),
	digest: z.string().max(200).optional(),
	release: z.string().max(100).optional(),
});
export async function POST(request: Request) {
	if (
		request.headers.get("origin") !==
			new URL(process.env.APP_URL || request.url).origin ||
		!request.headers.get("content-type")?.startsWith("application/json")
	)
		return new Response(null, { status: 403 });
	// The IP bucket is rotatable, so also require the browser's own fetch
	// metadata: a script hammering this endpoint from another site is
	// `cross-site`, while a real in-page reporter is never.
	const fetchSite = request.headers.get("sec-fetch-site");
	if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")
		return new Response(null, { status: 403 });
	const limit = await rateLimit(`cms-error:${await clientIp()}`, 20, 60000);
	if (!limit.ok) return new Response(null, { status: 429 });
	const reader = request.body?.getReader();
	if (!reader) return new Response(null, { status: 400 });
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > 16000) {
				await reader.cancel();
				return new Response(null, { status: 413 });
			}
			chunks.push(value);
		}
		const parsed = schema.safeParse(
			JSON.parse(Buffer.concat(chunks).toString("utf8")),
		);
		if (!parsed.success) return new Response(null, { status: 400 });
		const data = parsed.data;
		const error = new Error(data.message);
		error.stack = data.stack ?? "";
		const record = createErrorRecord("browser", data.event, error, {
			clientReference: data.clientReference ?? null,
			path: data.path.split("?")[0],
			digest: data.digest ?? null,
			clientRelease: data.release ?? "unknown",
		});
		await new ErrorStore().append(record);
		return NextResponse.json(
			{ id: record.id },
			{ status: 202, headers: { "Cache-Control": "no-store" } },
		);
	} catch {
		return new Response(null, { status: 503 });
	}
}
