// Public REST API — issue a personal access token for the SIGNED-IN user.
//
// POST /cms_api/tokens — mints a new Sanctum-style personal_access_token bound to
// the NextAuth-authenticated user and returns the plaintext ONCE. The plaintext
// is never stored (only its sha256 hash lives in the DB) so it cannot be shown
// again. Requires a logged-in web session, not a Bearer token.

import { apiError, apiJson } from "@/lib/api";
import { issueToken } from "@/lib/api-auth";
import { auth } from "@/lib/auth";
import { sessionUserId } from "@/lib/auth/session-user";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
	const session = await auth();
	const id = sessionUserId(session?.user?.id);
	if (!id) {
		return apiError("Unauthorized", 401);
	}

	if (!(await rateLimit(`tokens-issue:${id}`, 5, 60_000)).ok) {
		return apiError("Too many token requests. Please wait a minute.", 429);
	}

	const body = (await req.json().catch(() => ({}))) as { name?: unknown };
	const rawName = typeof body.name === "string" ? body.name.trim() : "";
	const name = rawName ? rawName.slice(0, 100) : "api";

	try {
		const token = await issueToken(id, name);
		if (!token) {
			return apiError("Could not issue token", 500);
		}
		// Plaintext token — shown only once, never recoverable afterwards.
		return apiJson({ token });
	} catch {
		return apiError("Could not issue token", 500);
	}
}
