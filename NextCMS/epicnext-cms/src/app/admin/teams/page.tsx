import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createTeam, deleteTeam } from "@/actions/admin-teams";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { db, WebsiteTeams } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

type TeamRow = {
	id: bigint;
	rankName: string;
	badge: string | null;
	jobDescription: string | null;
	staffColor: string;
	hiddenRank: boolean;
};

export default async function AdminTeams() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.USERS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.teams");
	let teams: TeamRow[] = [];
	try {
		teams = await db
			.select({
				id: WebsiteTeams.id,
				rankName: WebsiteTeams.rankName,
				badge: WebsiteTeams.badge,
				jobDescription: WebsiteTeams.jobDescription,
				staffColor: WebsiteTeams.staffColor,
				hiddenRank: WebsiteTeams.hiddenRank,
			})
			.from(WebsiteTeams)
			.orderBy(asc(WebsiteTeams.id));
	} catch {
		teams = [];
	}

	const hidden = teams.filter((t) => t.hiddenRank).length;

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard label={t("teamRanks")} value={teams.length} icon="🛡️" />
				<StatusCard
					label={t("visible")}
					value={teams.length - hidden}
					state={teams.length - hidden > 0 ? "ok" : "neutral"}
					icon="👁️"
				/>
				<StatusCard label={t("hidden")} value={hidden} icon="🙈" />
			</div>

			<div className="admin-card mb-6">
				<h3 className="mt-0">{t("newTeamRank")}</h3>
				<form action={createTeam} className="grid gap-2.5">
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<label className="grid gap-1">
							<span className="text-sm theme-text-muted dark:theme-text-muted">
								{t("rankName")}
							</span>
							<input
								name="rankName"
								placeholder={t("rankNamePlaceholder")}
								required
							/>
						</label>
						<label className="grid gap-1">
							<span className="text-sm theme-text-muted dark:theme-text-muted">
								{t("badgeCode")}
							</span>
							<input name="badge" placeholder={t("badgeCodePlaceholder")} />
						</label>
						<label className="grid gap-1">
							<span className="text-sm theme-text-muted dark:theme-text-muted">
								{t("jobDescription")}
							</span>
							<input
								name="jobDescription"
								placeholder={t("jobDescriptionPlaceholder")}
							/>
						</label>
						<label className="grid gap-1">
							<span className="text-sm theme-text-muted dark:theme-text-muted">
								{t("staffColor")}
							</span>
							<input
								name="staffColor"
								defaultValue="#327fa8"
								placeholder={t("staffColorPlaceholder")}
							/>
						</label>
					</div>
					<label className="flex items-center gap-1.5">
						<input type="checkbox" name="hiddenRank" className="w-auto" />
						<span className="text-sm theme-text-muted dark:theme-text-muted">
							{t("hiddenRank")}
						</span>
					</label>
					<div>
						<Button type="submit" variant="default">
							{t("createTeam")}
						</Button>
					</div>
				</form>
			</div>

			<section className="mt-6">
				<h2 className="admin-section-title">
					{t("ranksTitle", { count: teams.length })}
				</h2>
				{teams.length === 0 ? (
					<div className="admin-empty">{t("noTeams")}</div>
				) : (
					<div className="overflow-x-auto">
						<table>
							<thead>
								<tr>
									<th>{t("colId")}</th>
									<th>{t("rankName")}</th>
									<th>{t("badge")}</th>
									<th>{t("jobDescription")}</th>
									<th>{t("color")}</th>
									<th>{t("visibility")}</th>
									<th />
								</tr>
							</thead>
							<tbody>
								{teams.map((team) => (
									<tr key={String(team.id)}>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{String(team.id)}
										</td>
										<td>{team.rankName}</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{team.badge ?? "—"}
										</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{team.jobDescription ?? "—"}
										</td>
										<td>
											<span className="inline-flex items-center gap-1.5">
												<span
													aria-hidden
													className="h-3.5 w-3.5 rounded border border-[var(--admin-border)]"
													style={{ background: team.staffColor }}
												/>
												{team.staffColor}
											</span>
										</td>
										<td>
											<span
												className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${team.hiddenRank ? "bg-[var(--admin-accent)]/18 text-[var(--admin-text)]" : "bg-[var(--admin-success-subtle)] text-[var(--admin-text)]"}`}
											>
												{team.hiddenRank ? t("hidden") : t("visible")}
											</span>
										</td>
										<td>
											<form action={deleteTeam}>
												<input
													type="hidden"
													name="id"
													value={String(team.id)}
												/>
												<Button type="submit" variant="destructive">
													{t("delete")}
												</Button>
											</form>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</main>
	);
}
