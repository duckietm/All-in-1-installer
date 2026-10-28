import { z } from "zod";
import { notifications } from "@/features/notifications/server";
import { apiError, apiJson, apiUnavailable } from "@/lib/api";
import { auth } from "@/lib/auth";
import { sessionUserId } from "@/lib/auth/session-user";
import { rateLimit } from "@/lib/rate-limit";

const mutation = z.discriminatedUnion("action", [
	z
		.object({ action: z.literal("read"), key: z.string().min(1).max(128) })
		.strict(),
	z
		.object({
			action: z.literal("preferences"),
			preferences: z
				.object({
					support: z.boolean(),
					friends: z.boolean(),
					events: z.boolean(),
				})
				.strict(),
		})
		.strict(),
]);
export async function GET(req: Request) {
	const uid = sessionUserId((await auth())?.user?.id);
	if (!uid) return apiError("Unauthorized", 401);
	try {
		return apiJson(
			await notifications.feed(
				uid,
				Number(new URL(req.url).searchParams.get("page") ?? 1),
			),
		);
	} catch {
		return apiUnavailable();
	}
}
export async function POST(req: Request) {
	const uid = sessionUserId((await auth())?.user?.id);
	if (!uid) return apiError("Unauthorized", 401);
	if (req.headers.get("origin") !== new URL(req.url).origin)
		return apiError("Invalid origin", 403);
	if (!req.headers.get("content-type")?.startsWith("application/json"))
		return apiError("Invalid content type", 415);
	if (!(await rateLimit(`notifications:${uid}`, 60, 60_000)).ok)
		return apiError("Too many requests", 429);
	const body = await req.text();
	if (body.length > 2048) return apiError("Request too large", 413);
	let value: unknown;
	try {
		value = JSON.parse(body);
	} catch {
		return apiError("Invalid request");
	}
	const parsed = mutation.safeParse(value);
	if (!parsed.success) return apiError("Invalid request");
	try {
		if (parsed.data.action === "read") {
			if (!(await notifications.mark(uid, parsed.data.key)))
				return apiError("Notification not found", 404);
		} else await notifications.preferences(uid, parsed.data.preferences);
		return apiJson({ ok: true });
	} catch {
		return apiUnavailable();
	}
}
