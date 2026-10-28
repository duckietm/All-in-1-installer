import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { ContentCard, EmptyState, RankBadge } from "@/components/public/ui";
import {
	CurrencyIcon,
	type CurrencyKind,
} from "@/components/shared/currency-icon";
import { UserAvatarThumbnail } from "@/components/shared/user-avatar-thumbnail";
import { cached } from "@/lib/cache";
import { db, User, UsersCurrency, UsersSettings } from "@/lib/db";
import { loadProfilePrivacyMap } from "@/lib/services/profile-privacy";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.leaderboard");
	return {
		title: t("title"),
		description: t("subtitle", { currency: "credits" }),
		openGraph: {
			title: t("title"),
			description: t("subtitle", { currency: "credits" }),
			type: "website",
		},
	};
}

// Currency type ids (see UsersCurrency in src/db/schema.ts):
//   Credits = -1 (lives on users.credits), Duckets = 0, Diamonds = 5.
const TABS = [
	{ key: "credits", label: "Credits" },
	{ key: "diamonds", label: "Diamonds" },
	{ key: "duckets", label: "Duckets" },
	{ key: "achievement", label: "Achievement" },
	{ key: "respects", label: "Respects" },
	{ key: "onlinetime", label: "Online Time" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const CURRENCY_TYPE: Record<"diamonds" | "duckets", number> = {
	diamonds: 5,
	duckets: 0,
};

function formatValue(key: TabKey, value: number): string {
	if (key === "onlinetime") {
		const hours = Math.floor(value / 3600);
		const days = Math.floor(hours / 24);
		if (days > 0) return `${days}d ${hours % 24}h`;
		return `${hours}h`;
	}
	return value.toLocaleString();
}

type Row = { userId: number; username: string; look: string; value: number };

/**
 * Users who hid their wallet must not appear in the currency tabs: the profile
 * page already honours that, and a leaderboard that ignores it makes the
 * setting meaningless.
 */
async function withoutHiddenWallets(rows: Row[]): Promise<Row[]> {
	const privacy = await loadProfilePrivacyMap(rows.map((r) => r.userId));
	return rows.filter((r) => privacy.get(r.userId)?.wallet !== false);
}

async function loadCreditsRows(): Promise<Row[]> {
	try {
		const users = await cached(
			"lb_credits",
			60_000,
			() =>
				db
					.select({
						id: User.id,
						username: User.username,
						look: User.look,
						credits: User.credits,
					})
					.from(User)
					.orderBy(desc(User.credits))
					.limit(20),
			{ staleMs: 120000 },
		);
		return await withoutHiddenWallets(
			users.map((u) => ({
				userId: u.id,
				username: u.username,
				look: u.look,
				value: u.credits,
			})),
		);
	} catch {
		return [];
	}
}

async function loadCurrencyRows(type: number): Promise<Row[]> {
	try {
		return await cached(
			`lb_currency_${type}`,
			60_000,
			() =>
				db
					.select({
						userId: User.id,
						username: User.username,
						look: User.look,
						value: UsersCurrency.amount,
					})
					.from(UsersCurrency)
					.innerJoin(User, eq(UsersCurrency.userId, User.id))
					.where(eq(UsersCurrency.type, type))
					.orderBy(desc(UsersCurrency.amount))
					.limit(20),
			{ staleMs: 120000 },
		).then(withoutHiddenWallets);
	} catch {
		return [];
	}
}

async function loadSettingsRows(
	field: "achievementScore" | "respectsReceived" | "onlineTime",
): Promise<Row[]> {
	try {
		const column = UsersSettings[field];
		return await cached(
			`lb_settings_${field}`,
			60_000,
			() =>
				db
					.select({
						userId: User.id,
						username: User.username,
						look: User.look,
						value: column,
					})
					.from(UsersSettings)
					.innerJoin(User, eq(UsersSettings.userId, User.id))
					.orderBy(desc(column))
					.limit(20),
			{ staleMs: 120000 },
		);
	} catch {
		return [];
	}
}

const SETTINGS_FIELD: Record<
	"achievement" | "respects" | "onlinetime",
	"achievementScore" | "respectsReceived" | "onlineTime"
> = {
	achievement: "achievementScore",
	respects: "respectsReceived",
	onlinetime: "onlineTime",
};

export default async function LeaderboardPage({
	searchParams,
}: {
	searchParams: Promise<{ type?: string }>;
}) {
	const t = await getTranslations("pages.leaderboard");
	const { type } = await searchParams;
	const active: TabKey = TABS.some((tab) => tab.key === type)
		? (type as TabKey)
		: "credits";

	const rows = await (active === "credits"
		? loadCreditsRows()
		: active === "diamonds" || active === "duckets"
			? // active validated as "diamonds"|"duckets" in this branch
				loadCurrencyRows(CURRENCY_TYPE[active])
			: loadSettingsRows(
					SETTINGS_FIELD[active as keyof typeof SETTINGS_FIELD],
				));

	const activeCurrency: CurrencyKind | null =
		active === "credits" || active === "diamonds" || active === "duckets"
			? active
			: null;

	return (
		<section className="page-grid">
			<ContentCard
				icon="📊"
				title={t("title")}
				subtitle={t("subtitle", { currency: t(`tab_${active}`).toLowerCase() })}
			/>

			<div className="nav" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
				{TABS.map((t2) => (
					<Link
						key={t2.key}
						href={`/leaderboard?type=${t2.key}`}
						className={`btn ${t2.key === active ? "btn-primary" : "btn-outline"}`}
					>
						{t(`tab_${t2.key}`)}
					</Link>
				))}
			</div>

			<ContentCard padded={rows.length === 0}>
				{rows.length === 0 ? (
					<EmptyState icon="📊">{t("emptyState")}</EmptyState>
				) : (
					<div className="table-scroll">
						<table>
							<thead>
								<tr>
									<th style={{ width: "3rem" }}>#</th>
									<th style={{ width: "3.5rem" }}>{t("colAvatar")}</th>
									<th>{t("colPlayer")}</th>
									<th style={{ textAlign: "right" }}>{t(`tab_${active}`)}</th>
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
											<td style={{ textAlign: "right" }}>
												{activeCurrency ? (
													<span
														className="currency"
														style={{ display: "inline-flex" }}
													>
														<CurrencyIcon
															kind={activeCurrency}
															size={22}
															alt=""
														/>
														{row.value.toLocaleString()}
													</span>
												) : (
													<strong>{formatValue(active, row.value)}</strong>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</ContentCard>
		</section>
	);
}
