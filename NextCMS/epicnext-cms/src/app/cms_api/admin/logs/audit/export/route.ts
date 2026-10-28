import { parseListParams } from "@/lib/admin-helpers";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { getAuditLogs } from "@/lib/services/audit";
import { formatAuditValue, readAuditChanges } from "@/lib/services/audit-diff";

function cell(value: unknown) {
	const raw = value == null ? "" : String(value);
	const safe = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
	return `"${safe.replace(/"/g, '""')}"`;
}
export const GET = withAdmin(
	{ permission: PERMS.LOGS_VIEW },
	async (request) => {
		const params = new URL(request.url).searchParams;
		const { search, page, perPage } = parseListParams(params);
		const result = await getAuditLogs({
			search,
			page,
			perPage,
			actor: params.get("actor") ?? undefined,
			action: params.get("action") ?? undefined,
			from: params.get("from") ?? undefined,
			to: params.get("to") ?? undefined,
		});
		const format = params.get("format") || "csv";
		const rows: unknown[][] = [
			[
				"id",
				"user_id",
				"username",
				"action",
				"target",
				"target_id",
				"created_at",
				"changes",
			],
		];
		const jsonItems = [];
		for (const row of result.rows) {
			const details = readAuditChanges(row.diff, row.before, row.after);
			const changesFormatted = details.invalid
				? "[Unavailable legacy details]"
				: details.changes
						.map(
							(change) =>
								`${change.key}: ${formatAuditValue(change.from)} → ${formatAuditValue(change.to)}`,
						)
						.join("\n");
			rows.push([
				row.id,
				row.userId,
				row.username,
				row.action,
				row.target,
				row.targetId,
				row.createdAt,
				changesFormatted,
			]);
			jsonItems.push({
				id: row.id,
				userId: row.userId,
				username: row.username,
				action: row.action,
				target: row.target,
				targetId: row.targetId,
				createdAt: row.createdAt,
				changes: details.changes,
			});
		}
		if (format === "json") {
			return new Response(JSON.stringify(jsonItems, null, 2), {
				headers: {
					"Content-Type": "application/json; charset=utf-8",
					"Content-Disposition": 'attachment; filename="audit-page.json"',
					"Cache-Control": "no-store",
				},
			});
		}
		return new Response(
			`\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}`,
			{
				headers: {
					"Content-Type": "text/csv; charset=utf-8",
					"Content-Disposition": 'attachment; filename="audit-page.csv"',
					"Cache-Control": "no-store",
				},
			},
		);
	},
);
