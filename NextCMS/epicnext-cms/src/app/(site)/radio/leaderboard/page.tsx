import { sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { ContentCard, EmptyState, RankBadge } from "@/components/public/ui";
import { UserAvatarThumbnail } from "@/components/shared/user-avatar-thumbnail";
import { queryRows } from "@/lib/db";

type LeaderRow = {
	username: string;
	look: string;
	points: number | bigint;
};

async function loadRows(): Promise<
	{ username: string; look: string; points: number }[]
> {
	try {
		const rows = await queryRows<LeaderRow>(sql`
			SELECT u.username AS username, u.look AS look, p.points AS points
			FROM radio_listener_points p
			INNER JOIN users u ON u.id = p.user_id
			ORDER BY p.points DESC
			LIMIT 50
		`);
		return (rows ?? []).map((r) => ({
			username: r.username,
			look: r.look,
			points: Number(r.points),
		}));
	} catch {
		return [];
	}
}

export default async function RadioLeaderboardPage() {
	const t = await getTranslations("pages.radioLeaderboard");

	const rows = await loadRows();

	return (
		<section className="page-grid">
			<ContentCard icon="🏆" title={t("title")} subtitle={t("subtitle")} />

			<ContentCard padded={rows.length === 0}>
				{rows.length === 0 ? (
					<EmptyState icon="🏆">{t("empty")}</EmptyState>
				) : (
					<table>
						<thead>
							<tr>
								<th style={{ width: "3.5rem" }}>{t("colRank")}</th>
								<th style={{ width: "3.5rem" }}>{t("colAvatar")}</th>
								<th>{t("colListener")}</th>
								<th style={{ textAlign: "right" }}>{t("colPoints")}</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((row, i) => {
								return (
									<tr key={row.username}>
										<td>
											<RankBadge position={i + 1} />
										</td>
										<td>
											<UserAvatarThumbnail
												figure={row.look}
												alt={`${row.username} avatar`}
											/>
										</td>
										<td>
											<Link
												href={`/u/${encodeURIComponent(row.username)}`}
												style={{ fontWeight: 700 }}
											>
												{row.username}
											</Link>
										</td>
										<td style={{ textAlign: "right", fontWeight: 800 }}>
											{row.points.toLocaleString()}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</ContentCard>
		</section>
	);
}
