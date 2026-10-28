import { db, WebsiteIpBlacklist } from "@/lib/db";
import { ddosDetected } from "@/lib/services/alert";
import { siteSettings } from "@/lib/services/site-settings";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const recentlyBlocked = new Set<string>();

let blacklist = new Set<string>();
let blacklistLoadedAt = 0;
const BLACKLIST_TTL = 30_000;

const MAX_BUCKETS = 10_000;
const MAX_RECENTLY_BLOCKED = 1_000;
const CLEANUP_INTERVAL = 300_000;
let lastCleanup = Date.now();

function cleanupStaleEntries(): void {
	const now = Date.now();
	if (now - lastCleanup < CLEANUP_INTERVAL) return;
	lastCleanup = now;

	for (const [k, v] of buckets) {
		if (now >= v.resetAt) buckets.delete(k);
	}

	if (buckets.size > MAX_BUCKETS) {
		const sorted = [...buckets.entries()].sort(
			(a, b) => a[1].resetAt - b[1].resetAt,
		);
		const toRemove = Math.floor(sorted.length * 0.2);
		const keys = sorted.slice(0, toRemove).map((entry) => entry[0]);
		for (const key of keys) buckets.delete(key);
	}

	if (recentlyBlocked.size > MAX_RECENTLY_BLOCKED) {
		recentlyBlocked.clear();
	}
}

function isPrivate(ip: string): boolean {
	return (
		!ip ||
		ip === "0.0.0.0" ||
		ip === "::1" ||
		ip.startsWith("127.") ||
		ip.startsWith("10.") ||
		ip.startsWith("192.168.")
	);
}

export async function isIpBlacklisted(ip: string): Promise<boolean> {
	if (isPrivate(ip)) return false;
	const now = Date.now();
	if (now - blacklistLoadedAt >= BLACKLIST_TTL) {
		try {
			const rows = await db
				.select({ ipAddress: WebsiteIpBlacklist.ipAddress })
				.from(WebsiteIpBlacklist);
			blacklist = new Set(rows.map((r) => r.ipAddress));
			blacklistLoadedAt = now;
		} catch {
			/* keep stale set on DB error */
		}
	}
	return blacklist.has(ip);
}

export async function recordRequest(ip: string): Promise<void> {
	if (isPrivate(ip)) return;
	if (!(await siteSettings.getBool("abuse_guard_enabled", false))) return;

	const limit =
		Number(await siteSettings.get("abuse_guard_threshold", "200")) || 200;
	const windowMs =
		(Number(await siteSettings.get("abuse_guard_window_seconds", "10")) || 10) *
		1000;

	const now = Date.now();

	cleanupStaleEntries();

	const b = buckets.get(ip);
	if (!b || now >= b.resetAt) {
		buckets.set(ip, { count: 1, resetAt: now + windowMs });
		return;
	}
	b.count += 1;

	if (b.count >= limit && !recentlyBlocked.has(ip)) {
		recentlyBlocked.add(ip);
		setTimeout(() => recentlyBlocked.delete(ip), 60_000);
		try {
			await db.insert(WebsiteIpBlacklist).values({
				ipAddress: ip,
				createdAt: new Date(),
				updatedAt: new Date(),
			});
			blacklistLoadedAt = 0;
			await ddosDetected(ip, b.count);
		} catch {
			/* ignore — alert/blacklist best-effort */
		}
	}
}
