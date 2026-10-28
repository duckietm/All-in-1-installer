import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import {
	AclModelPermission,
	AclPermission,
	AclRole,
	db,
	WebsiteHousekeepingPermissions,
} from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { getAuditLogs } from "@/lib/services/audit";
import { AuditSection, ExportSection } from "./client";

export default async function AdminHousekeeping({
	searchParams,
}: {
	searchParams: Promise<{
		tab?:
			| "overview"
			| "manage"
			| "import"
			| "ranks"
			| "presets"
			| "test"
			| "audit"
			| "compare";
		group?: string;
	}>;
}) {
	const ctx = await getAdminContext();
	if (!canAccess(ctx.permissions, PERMS.SETTINGS_VIEW, ctx.session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.housekeeping");
	const sp = await searchParams;
	const tab = sp.tab ?? "overview";

	const allPermissions = await db
		.select()
		.from(WebsiteHousekeepingPermissions)
		.orderBy(
			asc(WebsiteHousekeepingPermissions.groupName),
			asc(WebsiteHousekeepingPermissions.permission),
		)
		.catch((): (typeof WebsiteHousekeepingPermissions.$inferSelect)[] => []);

	const ranks = allPermissions.map((p) => p.minRank);
	const maxRank = ranks.length ? Math.max(...ranks) : 0;
	const totalMin = ranks.reduce((sum, r) => sum + r, 0);

	const groupCounts: Record<string, number> = {};
	for (const p of allPermissions) {
		const g: string = p.groupName ?? "Uncategorized";
		groupCounts[g] = (groupCounts[g] || 0) + 1;
	}

	const rankGroups: Record<
		string,
		(typeof WebsiteHousekeepingPermissions.$inferSelect)[]
	> = {};
	for (const p of allPermissions) {
		const rk = String(p.minRank);
		if (!rankGroups[rk]) rankGroups[rk] = [];
		rankGroups[rk].push(p);
	}

	const aclSlugs = await db
		.select({ slug: AclPermission.slug })
		.from(AclPermission)
		.catch(() => [] as { slug: string }[]);
	const aclSlugSet = new Set(aclSlugs.map((p) => p.slug));

	const aclRolePerms = await db
		.select({
			roleSlug: AclRole.slug,
			permissionSlug: AclPermission.slug,
		})
		.from(AclModelPermission)
		.innerJoin(
			AclPermission,
			eq(AclModelPermission.permissionId, AclPermission.id),
		)
		.innerJoin(AclRole, eq(AclModelPermission.modelId, AclRole.id))
		.where(eq(AclModelPermission.modelType, "Role"))
		.catch((): { roleSlug: string; permissionSlug: string }[] => []);

	const aclMinRankBySlug = new Map<string, number>();
	for (const row of aclRolePerms) {
		const roleSlug = row.roleSlug;
		if (!roleSlug.startsWith("rank_")) continue;
		const rank = Number(roleSlug.slice(5));
		if (!Number.isFinite(rank)) continue;
		const slug = row.permissionSlug;
		const prev = aclMinRankBySlug.get(slug);
		if (prev === undefined || rank < prev) aclMinRankBySlug.set(slug, rank);
	}

	const compareRows = allPermissions.map((p) => {
		const inAcl = aclSlugSet.has(p.permission);
		const aclMin = aclMinRankBySlug.get(p.permission);
		return {
			permission: p.permission,
			hkMinRank: p.minRank,
			inAcl,
			aclMinRank: aclMin ?? null,
			aligned: inAcl && aclMin !== undefined ? aclMin === p.minRank : false,
		};
	});
	const missingInAcl = compareRows.filter((r) => !r.inAcl).length;
	const rankMismatch = compareRows.filter(
		(r) => r.inAcl && r.aclMinRank !== null && r.aclMinRank !== r.hkMinRank,
	).length;
	const alignedCount = compareRows.filter((r) => r.aligned).length;

	const auditLogs = await getAuditLogs({
		search: "housekeeping",
		perPage: 25,
	}).catch(() => null);

	return (
		<main>
			<div
				className="mb-4 rounded-lg border border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)] px-4 py-3 text-sm text-[var(--admin-text)]"
				role="status"
			>
				<p className="m-0 font-semibold">{t("legacyBannerTitle")}</p>
				<p className="m-0 mt-1 text-[var(--admin-text-muted)]">
					{t("legacyBannerBody")}{" "}
					<Link
						href="/admin/permissions"
						className="font-medium text-[var(--admin-accent)] underline-offset-2 hover:underline"
					>
						{t("legacyBannerCta")}
					</Link>
				</p>
				<p className="m-0 mt-2 text-xs text-[var(--admin-text-muted)]">
					{t("writesRetired")}
				</p>
			</div>

			<div className="admin-tabs mb-4">
				<Link
					href="/admin/housekeeping?tab=overview"
					className={`admin-tab ${tab === "overview" ? "active" : ""}`}
				>
					{t("tabOverview")}
				</Link>
				<Link
					href="/admin/housekeeping?tab=compare"
					className={`admin-tab ${tab === "compare" ? "active" : ""}`}
				>
					{t("tabCompare")}
				</Link>
				<Link
					href="/admin/housekeeping?tab=ranks"
					className={`admin-tab ${tab === "ranks" ? "active" : ""}`}
				>
					{t("tabRanks")}
				</Link>
				<Link
					href="/admin/housekeeping?tab=import"
					className={`admin-tab ${tab === "import" ? "active" : ""}`}
				>
					{t("tabExportOnly")}
				</Link>
				<Link
					href="/admin/housekeeping?tab=audit"
					className={`admin-tab ${tab === "audit" ? "active" : ""}`}
				>
					{t("tabAudit")}
				</Link>
			</div>

			{tab === "overview" && (
				<>
					<div className="admin-stat-row">
						<span className="admin-stat-chip">
							{t("permissionsCount", { count: allPermissions.length })}
						</span>
						<span className="admin-stat-chip">
							{t("highestMinRank", { rank: maxRank })}
						</span>
						<span className="admin-stat-chip">
							{t("totalMinRank", { total: totalMin })}
						</span>
						<span className="admin-stat-chip">
							{t("groupCount", { count: Object.keys(groupCounts).length })}
						</span>
						<span className="admin-stat-chip">
							{t("compareAligned", { count: alignedCount })}
						</span>
						<span className="admin-stat-chip">
							{t("compareMissingAcl", { count: missingInAcl })}
						</span>
						<span className="admin-stat-chip">
							{t("compareMismatch", { count: rankMismatch })}
						</span>
					</div>

					<section className="mb-6">
						<h2 className="admin-section-title">{t("perGroup")}</h2>
						<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
							{Object.entries(groupCounts)
								.sort(([a], [b]) => a.localeCompare(b))
								.map(([group, count]) => (
									<div key={group} className="admin-card p-3">
										<div className="font-semibold text-sm">{group}</div>
										<div className="text-xs opacity-60">
											{count} {count === 1 ? t("permission") : t("permissions")}
										</div>
									</div>
								))}
						</div>
					</section>

					<section>
						<h2 className="admin-section-title">{t("perRank")}</h2>
						<div className="overflow-x-auto">
							<table>
								<thead>
									<tr>
										<th>{t("rank")}</th>
										<th>{t("count")}</th>
										<th>{t("permissions")}</th>
									</tr>
								</thead>
								<tbody>
									{Object.entries(rankGroups)
										.sort(([a], [b]) => Number(b) - Number(a))
										.map(([rank, perms]) => (
											<tr key={rank}>
												<td className="font-semibold">Rank {rank}</td>
												<td>{perms.length}</td>
												<td className="text-xs opacity-70">
													{perms.map((p) => p.permission).join(", ")}
												</td>
											</tr>
										))}
								</tbody>
							</table>
						</div>
					</section>
				</>
			)}

			{tab === "compare" && (
				<section>
					<h2 className="admin-section-title">{t("tabCompare")}</h2>
					<p className="text-xs text-[var(--admin-text-muted)] -mt-2 mb-3">
						{t("compareHint")}
					</p>
					<div className="overflow-x-auto">
						<table>
							<thead>
								<tr>
									<th>{t("colPermission")}</th>
									<th>{t("colMinRank")}</th>
									<th>{t("colAclPresent")}</th>
									<th>{t("colAclMinRank")}</th>
									<th>{t("colStatus")}</th>
								</tr>
							</thead>
							<tbody>
								{compareRows.map((row) => {
									const status = !row.inAcl
										? t("statusMissingAcl")
										: row.aligned
											? t("statusAligned")
											: t("statusMismatch");
									return (
										<tr key={row.permission}>
											<td>
												<code className="text-xs">{row.permission}</code>
											</td>
											<td>{row.hkMinRank}</td>
											<td>{row.inAcl ? "✓" : "—"}</td>
											<td>{row.aclMinRank ?? "—"}</td>
											<td className="text-xs">{status}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</section>
			)}

			{tab === "import" && (
				<div className="mt-2">
					<p className="mb-4 text-sm text-[var(--admin-text-muted)]">
						{t("exportOnlyHint")}
					</p>
					<ExportSection />
				</div>
			)}

			{tab === "ranks" && (
				<section>
					<h2 className="admin-section-title">{t("perRank")}</h2>
					<p className="text-xs text-[var(--admin-text-muted)] -mt-2 mb-3">
						{t("rankOverviewHint")}
					</p>
					{Object.keys(rankGroups).length === 0 ? (
						<div className="admin-empty">{t("noPermissions")}</div>
					) : (
						<div className="space-y-4">
							{Object.entries(rankGroups)
								.sort(([a], [b]) => Number(b) - Number(a))
								.map(([rank, perms]) => {
									const groupsInRank: Record<string, typeof perms> = {};
									for (const p of perms) {
										const g = p.groupName ?? "Uncategorized";
										if (!groupsInRank[g]) groupsInRank[g] = [];
										groupsInRank[g].push(p);
									}
									return (
										<div key={rank} className="admin-card">
											<div className="flex items-center justify-between mb-2">
												<h3 className="text-lg font-bold">
													{t("rank")} {rank}
												</h3>
												<span className="text-sm opacity-60">
													{perms.length} {t("permissions")}
												</span>
											</div>
											<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
												{Object.entries(groupsInRank)
													.sort(([a], [b]) => a.localeCompare(b))
													.map(([group, groupPerms]) => (
														<div key={group}>
															<div className="text-xs font-semibold uppercase tracking-wider opacity-60 mb-1">
																{group}
															</div>
															<ul className="list-disc pl-4 text-xs space-y-0.5">
																{groupPerms.map((p) => (
																	<li key={p.permission}>
																		{p.permission}
																		{p.dependsOn ? (
																			<span className="opacity-50 ml-1">
																				&rarr; {p.dependsOn}
																			</span>
																		) : null}
																	</li>
																))}
															</ul>
														</div>
													))}
											</div>
										</div>
									);
								})}
						</div>
					)}
				</section>
			)}

			{tab === "audit" && <AuditSection initialLogs={auditLogs} />}
		</main>
	);
}
