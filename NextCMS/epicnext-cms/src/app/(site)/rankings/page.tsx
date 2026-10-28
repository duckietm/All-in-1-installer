import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { PublicLoadError } from "@/components/public/load-error";
import {
	ContentCard,
	EmptyState,
	OnlineBadge,
	RankBadge,
} from "@/components/public/ui";
import { CurrencyIcon } from "@/components/shared/currency-icon";
import { UserAvatarThumbnail } from "@/components/shared/user-avatar-thumbnail";
import { cached } from "@/lib/cache";
import { db, User } from "@/lib/db";
import { publicReadFailure } from "@/lib/services/public-read";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.rankings");
	return {
		title: t("title"),
		description: t("subtitle"),
		openGraph: {
			title: t("title"),
			description: t("subtitle"),
			type: "website",
		},
	};
}

type TopUser = {
	username: string;
	look: string;
	credits: number;
	rank: number;
	online: string;
};

export default async function RankingsPage() {
	const t = await getTranslations("pages.rankings");
	let users: TopUser[] | null = [];
	try {
		users = await cached(
			"rankings:top",
			60_000,
			async () =>
				db
					.select({
						username: User.username,
						look: User.look,
						credits: User.credits,
						rank: User.rank,
						online: User.online,
					})
					.from(User)
					.orderBy(desc(User.credits))
					.limit(12),
			{ staleMs: 120000 },
		);
	} catch (error) {
		users = publicReadFailure("rankings")(error);
	}

	return (
		<section className="page-grid">
			<ContentCard icon="🏆" title={t("title")} subtitle={t("subtitle")} />

			<ContentCard padded={!users?.length}>
				{users === null ? (
					<PublicLoadError href="/rankings" />
				) : users.length === 0 ? (
					<EmptyState icon="🏆">{t("emptyState")}</EmptyState>
				) : (
					<div className="card-grid sm-2 lg-3" style={{ padding: "1rem" }}>
						{users.map((u, i) => {
							return (
								<div
									key={u.username}
									className="card hover"
									style={{
										display: "flex",
										gap: "0.9rem",
										alignItems: "center",
									}}
								>
									<RankBadge position={i + 1} />
									<UserAvatarThumbnail
										figure={u.look}
										alt={`${u.username} avatar`}
									/>
									<div style={{ minWidth: 0, flex: 1 }}>
										<h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem" }}>
											<Link href={`/u/${u.username}`}>{u.username}</Link>
										</h3>
										<p className="currency" style={{ margin: "0 0 0.3rem" }}>
											<CurrencyIcon kind="credits" size={22} alt="" />
											{u.credits.toLocaleString()}
										</p>
										<OnlineBadge online={u.online === "1"} />
									</div>
								</div>
							);
						})}
					</div>
				)}
			</ContentCard>
		</section>
	);
}
