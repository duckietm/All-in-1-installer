import { apiError, apiJson, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import {
	NitroScanConflictError,
	runScanInBackground,
} from "@/lib/services/nitro-scan-session";

/**
 * Start (or re-attach to) the furniture asset scan in the background. The scan
 * keeps running detached in the server process once this returns, so closing
 * the tab does not lose it. Clients poll GET `/session` for progress and fetch
 * the result through GET `/data`.
 *
 * @returns 200 with the started session, or 409 with `conflict: true` and the
 *   in-flight session when a fresh scan is already running (<= the 60s stale
 *   window) — the client should attach to that instead of starting a new one.
 */
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		let body: { force?: unknown };
		try {
			body = await request.json();
		} catch {
			body = {};
		}
		const force = body?.force === true;
		try {
			const session = await runScanInBackground({ force });
			logAudit({
				userId: ctx.session.user.id,
				action: "nitro_cleanup_scan",
				target: "AssetFiles",
				after: { force, sessionId: session.id },
			});
			return apiOk({ session });
		} catch (err) {
			if (err instanceof NitroScanConflictError) {
				return apiJson(
					{ ok: true, session: err.session, conflict: true },
					{ status: 409 },
				);
			}
			return apiError(`Failed to start scan: ${(err as Error).message}`, 500);
		}
	},
);
