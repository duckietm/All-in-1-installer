import { redirect } from "next/navigation";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { getAuditLogs } from "@/lib/services/audit";
import { AuditTable } from "./audit-table";

export default async function AuditLogsPage({
	params: paramsPromise,
	searchParams,
}: {
	params: Promise<{ locale: string }>;
	searchParams: Promise<Record<string, string>>;
}) {
	await paramsPromise;
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.LOGS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const params = await searchParams;
	const sp = new URLSearchParams(params);
	const { search, perPage, page } = parseListParams(sp);

	const result = await getAuditLogs({
		search,
		page,
		perPage,
		actor: sp.get("actor") ?? undefined,
		action: sp.get("action") ?? undefined,
		from: sp.get("from") ?? undefined,
		to: sp.get("to") ?? undefined,
	});

	const pagination = calcPagination(result.total, result.page, result.perPage);

	const rows = result.rows.map((r) => ({
		id: r.id,
		username: r.username,
		action: r.action,
		target: r.target,
		targetId: r.targetId,
		diff: r.diff,
		before: r.before,
		after: r.after,
		createdAt: r.createdAt,
	}));

	return (
		<div className="space-y-6">
			<AuditTable data={{ rows, ...pagination }} />
		</div>
	);
}
