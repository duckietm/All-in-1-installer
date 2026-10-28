import { and, eq, gt, or } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { unixNow } from "@/lib/bans";
import { resolveClientIp } from "@/lib/client-ip";
import { Ban, db } from "@/lib/db";
import { safeRedirect } from "@/lib/foundation/security";
import { logger } from "@/lib/logger";
import { isIpBlacklisted, recordRequest } from "@/lib/services/abuse-guard";
import { siteSettings } from "@/lib/services/site-settings";

const EXEMPT = [
	"/banned",
	"/maintenance",
	"/login",
	"/register",
	"/forgot",
	"/reset",
	"/cms_api",
];

function isExempt(path: string): boolean {
	return EXEMPT.some((p) => path === p || path.startsWith(`${p}/`));
}

export async function enforceSiteAccess(): Promise<void> {
	const h = await headers();
	const path = h.get("x-pathname") ?? "/";
	const ip = resolveClientIp(h);

	void recordRequest(ip).catch(() => {});

	if (isExempt(path)) return;

	let target: string | null = null;
	let checksDegraded = false;

	try {
		if (await isIpBlacklisted(ip)) target = "/banned";
	} catch {
		checksDegraded = true;
	}

	try {
		const session = await auth();
		const rank = session?.user?.rank ?? 0;

		try {
			if (
				!target &&
				(await siteSettings.getBool("maintenance_enabled", false))
			) {
				const minLogin =
					Number(await siteSettings.get("min_maintenance_login_rank", "7")) ||
					7;
				if (rank < minLogin) target = "/maintenance";
			}
		} catch {
			checksDegraded = true;
		}

		try {
			if (!target && session?.user?.id) {
				const now = unixNow();
				const [ban] = await db
					.select({ id: Ban.id })
					.from(Ban)
					.where(
						and(
							eq(Ban.userId, Number(session.user.id)),
							or(eq(Ban.banExpire, 0), gt(Ban.banExpire, now)),
						),
					)
					.limit(1);
				if (ban) target = "/banned";
			}
		} catch {
			checksDegraded = true;
		}
	} catch {
		checksDegraded = true;
	}

	if (target) {
		redirect(safeRedirect(target, target));
	}

	if (checksDegraded) {
		logger.warn("Access guard degraded — some checks skipped", { ip, path });
	}
}
