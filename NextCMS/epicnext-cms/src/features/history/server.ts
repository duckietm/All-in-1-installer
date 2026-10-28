import "server-only";
import { eq, getTableColumns, sql } from "drizzle-orm";
import {
	AdminAuditLog,
	CatalogItems,
	CatalogPages,
	CatalogPagesBc,
	WebsiteArticles,
} from "@/db/schema";
import { type db, rowsFrom } from "@/lib/db";
import { getOperationContext } from "@/lib/foundation/request-context";
import { type HistorySnapshot, sameSnapshot } from "./model";
export type HistoryKind =
	| "category"
	| "category_bc"
	| "prices"
	| "catalog_offer"
	| "news";
export type HistoryTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];
const categoryFields = [
	"caption",
	"captionSave",
	"pageLayout",
	"enabled",
	"visible",
	"clubOnly",
	"vipOnly",
	"minRank",
	"iconImage",
	"iconColor",
	"pageHeadline",
	"pageTeaser",
	"pageSpecial",
	"pageText1",
	"pageText2",
	"pageTextDetails",
	"pageTextTeaser",
	"includes",
];
const configs = {
	catalog_offer: {
		table: CatalogItems,
		fields: ["pageId", "costCredits", "costPoints", "pointsType"],
	},
	category: { table: CatalogPages, fields: categoryFields },
	category_bc: { table: CatalogPagesBc, fields: categoryFields },
	prices: {
		table: CatalogItems,
		fields: ["costCredits", "costPoints", "pointsType"],
	},
	news: {
		table: WebsiteArticles,
		fields: [
			"title",
			"slug",
			"image",
			"shortStory",
			"fullStory",
			"status",
			"publishAt",
			"publishedAt",
		],
	},
};
export function historyConfig(kind: string) {
	if (!Object.hasOwn(configs, kind)) throw Error("unavailable");
	const config = configs[kind as HistoryKind];
	const columns = getTableColumns(config.table);
	return {
		...config,
		fields: config.fields.filter((key) => Object.hasOwn(columns, key)),
	};
}
export async function historySnapshot(
	tx: HistoryTransaction,
	kind: HistoryKind,
	id: number | string,
): Promise<HistorySnapshot> {
	const { table, fields } = historyConfig(kind);
	const columns = getTableColumns(table);
	const selected = fields.map(
		(key) =>
			sql`${sql.identifier(columns[key as keyof typeof columns].name)} AS ${sql.identifier(key)}`,
	);
	const row = rowsFrom<Record<string, unknown>>(
		await tx.execute(
			sql`SELECT ${sql.join(selected, sql`, `)} FROM ${table} WHERE id=${id} FOR UPDATE`,
		),
	)[0];
	if (!row) throw Error("unavailable");
	return Object.fromEntries(
		fields.map((key) => {
			const value = row[key];
			return [
				key,
				value instanceof Date
					? value.toISOString()
					: value == null
						? null
						: typeof value === "number"
							? value
							: String(value),
			];
		}),
	);
}
export async function recordHistory(
	tx: HistoryTransaction,
	kind: HistoryKind,
	id: number | string,
	userId: number,
	before: HistorySnapshot,
	action = "history_update",
) {
	const after = await historySnapshot(tx, kind, id);
	if (sameSnapshot(before, after)) return;
	const serializedBefore = JSON.stringify(before);
	const serializedAfter = JSON.stringify(after);
	if (
		Buffer.byteLength(serializedBefore, "utf8") > 16_000_000 ||
		Buffer.byteLength(serializedAfter, "utf8") > 16_000_000
	)
		throw Error("History snapshot is too large");
	const inserted = await tx.insert(AdminAuditLog).values({
		userId,
		action,
		target: kind,
		targetId: Number(id) <= 2147483647 ? Number(id) : null,
		details: JSON.stringify({
			...getOperationContext(),
			...(Number(id) > 2147483647 ? { targetId: String(id) } : {}),
		}),
		before: serializedBefore,
		after: serializedAfter,
		createdAt: new Date().toISOString(),
	});
	return inserted?.[0]?.insertId;
}
export async function readHistory(tx: HistoryTransaction, id: number) {
	const [entry] = await tx
		.select()
		.from(AdminAuditLog)
		.where(eq(AdminAuditLog.id, id))
		.limit(1);
	if (!entry || !["history_update", "history_restore"].includes(entry.action))
		throw Error("unavailable");
	let targetId: number | string | null = entry.targetId;
	if (targetId === null && entry.target === "news") {
		const details = JSON.parse(entry.details ?? "null");
		if (
			typeof details?.targetId === "string" &&
			/^[1-9]\d{0,19}$/.test(details.targetId)
		)
			targetId = details.targetId;
	}
	if (targetId === null) throw Error("unavailable");
	const config = historyConfig(entry.target);
	const parse = (raw: string | null): HistorySnapshot => {
		const value: unknown = JSON.parse(raw ?? "null");
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw Error("unavailable");
		const data = value as HistorySnapshot;
		if (
			Object.keys(data).length !== config.fields.length ||
			!config.fields.every(
				(key) =>
					Object.hasOwn(data, key) &&
					(data[key] === null ||
						typeof data[key] === "string" ||
						typeof data[key] === "number"),
			)
		)
			throw Error("unavailable");
		return data;
	};
	return {
		kind: entry.target as HistoryKind,
		targetId,
		before: parse(entry.before),
		after: parse(entry.after),
	};
}
export async function applyHistory(
	tx: HistoryTransaction,
	entry: Awaited<ReturnType<typeof readHistory>>,
	userId: number,
) {
	if (entry.kind === "catalog_offer") await lockOfferHistoryPages(tx, [entry]);
	const current = await historySnapshot(tx, entry.kind, entry.targetId);
	if (!sameSnapshot(current, entry.after)) throw Error("conflict");
	const { table } = historyConfig(entry.kind);
	const columns = getTableColumns(table);
	const assignments = Object.entries(entry.before).map(
		([key, value]) =>
			sql`${sql.identifier(columns[key as keyof typeof columns].name)}=${entry.kind === "news" && (key === "publishAt" || key === "publishedAt") && value ? new Date(String(value)) : value}`,
	);
	if (entry.kind === "news") assignments.push(sql`updated_at=${new Date()}`);
	await tx.execute(
		sql`UPDATE ${table} SET ${sql.join(assignments, sql`, `)} WHERE id=${entry.targetId}`,
	);
	await recordHistory(
		tx,
		entry.kind,
		entry.targetId,
		userId,
		current,
		"history_restore",
	);
}

export async function lockOfferHistoryPages(
	tx: HistoryTransaction,
	entries: Array<Awaited<ReturnType<typeof readHistory>>>,
) {
	const ids = [
		...new Set(
			entries.flatMap((entry) => [
				Number(entry.before.pageId),
				Number(entry.after.pageId),
			]),
		),
	].sort((a, b) => a - b);
	if (ids.some((id) => !Number.isSafeInteger(id) || id < 1))
		throw Error("unavailable");
	const found = new Set(
		rowsFrom<{ id: number }>(
			await tx.execute(
				sql`SELECT id FROM catalog_pages WHERE id IN (${sql.join(ids, sql`, `)}) ORDER BY id FOR UPDATE`,
			),
		).map((row) => Number(row.id)),
	);
	if (ids.some((id) => !found.has(id))) throw Error("unavailable");
}
