import { and, count, desc, eq, gte, inArray, like, lt, or } from "drizzle-orm";
import { AdminAuditLog, db, User } from "@/lib/db";
import { getOperationContext } from "@/lib/foundation/request-context";
import { readAuditChanges } from "./audit-diff";
import { type AuditFilters, normalizeAuditFilters } from "./audit-filters";

interface AuditEntry {
	userId: number;
	action: string;
	target: string;
	targetId?: number;
	before?: Record<string, unknown>;
	after?: Record<string, unknown>;
}

const SENSITIVE_KEY_RE =
	/password|secret|token|otp|recovery|authTicket|two_factor|two_factor_secret|api_key/i;
const REDACTED = "[Redacted]";

function sanitizeAuditPayload(value: unknown, depth = 0): unknown {
	if (depth > 6 || value == null) return value;
	if (Array.isArray(value))
		return value.map((v) => sanitizeAuditPayload(v, depth + 1));
	if (typeof value !== "object") return value;

	const out: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
		out[key] = SENSITIVE_KEY_RE.test(key)
			? REDACTED
			: sanitizeAuditPayload(val, depth + 1);
	}
	return out;
}

function computeDiff(
	before?: Record<string, unknown>,
	after?: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> | null {
	if (!before || !after) return null;

	const diff: Record<string, { from: unknown; to: unknown }> = {};
	const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

	for (const key of allKeys) {
		if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
			diff[key] = { from: before[key], to: after[key] };
		}
	}

	return Object.keys(diff).length > 0 ? diff : null;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
	const sanitizedBefore = entry.before
		? (sanitizeAuditPayload(entry.before) as Record<string, unknown>)
		: undefined;
	const sanitizedAfter = entry.after
		? (sanitizeAuditPayload(entry.after) as Record<string, unknown>)
		: undefined;
	const diff = computeDiff(sanitizedBefore, sanitizedAfter);

	await db.insert(AdminAuditLog).values({
		userId: entry.userId,
		details: JSON.stringify(getOperationContext()),
		action: entry.action,
		target: entry.target,
		targetId: entry.targetId,
		before: sanitizedBefore ? JSON.stringify(sanitizedBefore) : null,
		after: sanitizedAfter ? JSON.stringify(sanitizedAfter) : null,
		diff: diff ? JSON.stringify(diff) : null,
		createdAt: new Date().toISOString(),
	});
}

export async function getAuditLogs(options: AuditFilters = {}) {
	const { search, actor, action, from, until, page, perPage } =
		normalizeAuditFilters(options);
	const skip = (page - 1) * perPage;
	const where = and(
		search
			? or(
					like(AdminAuditLog.action, `%${search}%`),
					like(AdminAuditLog.target, `%${search}%`),
					like(AdminAuditLog.details, `%${search}%`),
				)
			: undefined,
		action ? eq(AdminAuditLog.action, action) : undefined,
		actor
			? /^[1-9]\d*$/.test(actor) && Number.isSafeInteger(Number(actor))
				? eq(AdminAuditLog.userId, Number(actor))
				: inArray(
						AdminAuditLog.userId,
						db
							.select({ id: User.id })
							.from(User)
							.where(eq(User.username, actor)),
					)
			: undefined,
		from ? gte(AdminAuditLog.createdAt, from) : undefined,
		until ? lt(AdminAuditLog.createdAt, until) : undefined,
	);
	const [rows, totalResult] = await Promise.all([
		db
			.select({
				id: AdminAuditLog.id,
				userId: AdminAuditLog.userId,
				action: AdminAuditLog.action,
				target: AdminAuditLog.target,
				targetId: AdminAuditLog.targetId,
				diff: AdminAuditLog.diff,
				operationDetails: AdminAuditLog.details,
				before: AdminAuditLog.before,
				after: AdminAuditLog.after,
				createdAt: AdminAuditLog.createdAt,
			})
			.from(AdminAuditLog)
			.where(where)
			.orderBy(desc(AdminAuditLog.id))
			.limit(perPage)
			.offset(skip),
		db.select({ value: count() }).from(AdminAuditLog).where(where),
	]);

	const total = Number(totalResult[0]?.value ?? 0);

	const userIds = [...new Set(rows.map((r) => r.userId))];
	const users =
		userIds.length > 0
			? await db
					.select({ id: User.id, username: User.username })
					.from(User)
					.where(inArray(User.id, userIds))
			: [];
	const userMap = new Map(users.map((u) => [u.id, u.username]));

	const enrichedRows = rows.map((r) => {
		const details = readAuditChanges(r.diff, r.before, r.after);
		let operationId: string | null = null;
		try {
			const meta = JSON.parse(r.operationDetails ?? "{}");
			if (
				typeof meta.operationId === "string" &&
				/^[a-zA-Z0-9-]{1,100}$/.test(meta.operationId)
			)
				operationId = meta.operationId;
		} catch {}
		const { operationDetails: _privateDetails, ...safeRow } = r;
		return {
			...safeRow,
			operationId,
			// Only sanitized changes may cross the server/client boundary.
			before: null,
			after: null,
			diff: details.invalid
				? "[Unavailable legacy details]"
				: details.changes.length
					? JSON.stringify(
							Object.fromEntries(
								details.changes.map(({ key, from, to }) => [key, { from, to }]),
							),
						)
					: null,
			username: userMap.get(r.userId) ?? `User #${r.userId}`,
		};
	});

	return {
		rows: enrichedRows,
		total,
		page,
		perPage,
		lastPage: Math.ceil(total / perPage),
	};
}
