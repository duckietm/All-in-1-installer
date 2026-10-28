import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { StatusCard } from "@/components/admin/dashboard";
import { Achievements, db } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

type Achievement = {
	name: string;
	category: string;
	level: number;
	rewardAmount: number;
	rewardType: number;
	points: number | null;
	progressNeeded: number;
};

export default async function AdminAchievements() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.CATALOG_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.achievements");

	let achievements: Achievement[];
	try {
		achievements = await db
			.select({
				name: Achievements.name,
				category: Achievements.category,
				level: Achievements.level,
				rewardAmount: Achievements.rewardAmount,
				rewardType: Achievements.rewardType,
				points: Achievements.points,
				progressNeeded: Achievements.progressNeeded,
			})
			.from(Achievements)
			.orderBy(
				asc(Achievements.category),
				asc(Achievements.name),
				asc(Achievements.level),
			);
	} catch {
		achievements = [];
	}

	const groups = new Map<string, Achievement[]>();
	for (const a of achievements) {
		const list = groups.get(a.category) ?? [];
		list.push(a);
		groups.set(a.category, list);
	}

	const distinctNames = new Set(achievements.map((a) => a.name)).size;

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard
					label={t("achievementRows")}
					value={achievements.length}
					icon="🏆"
				/>
				<StatusCard
					label={t("distinctAchievements")}
					value={distinctNames}
					icon="🎖️"
				/>
				<StatusCard label={t("categories")} value={groups.size} icon="🗂️" />
			</div>

			{groups.size === 0 ? (
				<div className="admin-empty">{t("noAchievements")}</div>
			) : (
				[...groups.entries()].map(([category, rows]) => (
					<section key={category} className="mt-6">
						<h2 className="admin-section-title">
							{category}{" "}
							<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-accent)]/18 text-[var(--admin-text)]">
								{rows.length}
							</span>
						</h2>
						<div className="admin-card p-0 overflow-x-auto">
							<table>
								<thead>
									<tr>
										<th>{t("colName")}</th>
										<th>{t("colLevel")}</th>
										<th>{t("colProgress")}</th>
										<th>{t("colRewardType")}</th>
										<th>{t("colRewardAmount")}</th>
										<th>{t("colPoints")}</th>
									</tr>
								</thead>
								<tbody>
									{rows.map((a) => (
										<tr key={`${a.name}-${a.level}`}>
											<td>
												<strong>{a.name}</strong>
											</td>
											<td>{a.level}</td>
											<td>{a.progressNeeded}</td>
											<td>{a.rewardType}</td>
											<td>{a.rewardAmount}</td>
											<td>{a.points ?? 0}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>
				))
			)}
		</main>
	);
}
