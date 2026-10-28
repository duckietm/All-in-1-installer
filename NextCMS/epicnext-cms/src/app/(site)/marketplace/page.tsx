import { desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentCard, EmptyState, StatBlock } from "@/components/public/ui";
import { db, MarketplaceItems, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.marketplace");
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

// state == 1 → an active, unsold offer in the Arcturus marketplace.
const STATE_ACTIVE = 1;

type RelativeTimeTranslator = (
	key: string,
	values?: Record<string, number>,
) => string;

function listedAgo(ts: number, t: RelativeTimeTranslator): string {
	const now = Math.floor(Date.now() / 1000);
	const diff = Math.max(0, now - ts);
	if (diff < 60) return t("justNow");
	const mins = Math.floor(diff / 60);
	if (mins < 60) return t("minutesAgo", { count: mins });
	const hours = Math.floor(mins / 60);
	if (hours < 24) return t("hoursAgo", { count: hours });
	const days = Math.floor(hours / 24);
	return t("daysAgo", { count: days });
}

export default async function MarketplacePage() {
	const t = await getTranslations("pages.marketplace");
	let offers: {
		id: number;
		itemId: number;
		userId: number;
		price: number;
		timestamp: number;
	}[] = [];
	try {
		offers = await db
			.select({
				id: MarketplaceItems.id,
				itemId: MarketplaceItems.itemId,
				userId: MarketplaceItems.userId,
				price: MarketplaceItems.price,
				timestamp: MarketplaceItems.timestamp,
			})
			.from(MarketplaceItems)
			.where(eq(MarketplaceItems.state, STATE_ACTIVE))
			.orderBy(desc(MarketplaceItems.timestamp))
			.limit(100);
	} catch {
		offers = [];
	}

	// Resolve seller usernames in a single query (read-only display join).
	let sellers = new Map<number, string>();
	try {
		const ids = [...new Set(offers.map((o) => o.userId))];
		if (ids.length > 0) {
			const users = await db
				.select({ id: User.id, username: User.username })
				.from(User)
				.where(inArray(User.id, ids));
			sellers = new Map(users.map((u) => [u.id, u.username]));
		}
	} catch {
		sellers = new Map();
	}

	const total = offers.reduce((sum, o) => sum + o.price, 0);

	return (
		<section className="page-grid">
			<ContentCard icon="🛍️" title={t("title")} subtitle={t("subtitle")}>
				<div className="stat-grid">
					<StatBlock
						value={offers.length.toLocaleString()}
						label={t("activeOffers")}
						icon="🏷️"
					/>
					<StatBlock
						value={new Set(offers.map((o) => o.userId)).size.toLocaleString()}
						label={t("sellers")}
						icon="👥"
					/>
					<StatBlock
						value={`${total.toLocaleString()} cr`}
						label={t("totalValue")}
						icon="🪙"
					/>
				</div>
			</ContentCard>

			<ContentCard
				icon="📋"
				title={t("activeListings")}
				subtitle={offers.length > 0 ? t("mostRecentFirst") : undefined}
				padded={offers.length === 0}
			>
				{offers.length === 0 ? (
					<EmptyState icon="🛍️">{t("empty")}</EmptyState>
				) : (
					<div style={{ padding: "0.25rem 1rem 0.75rem", overflowX: "auto" }}>
						<table>
							<thead>
								<tr>
									<th>{t("colOffer")}</th>
									<th>{t("colItem")}</th>
									<th>{t("colSeller")}</th>
									<th>{t("colPrice")}</th>
									<th>{t("colListed")}</th>
								</tr>
							</thead>
							<tbody>
								{offers.map((o) => (
									<tr key={o.id}>
										<td className="muted">#{o.id}</td>
										<td>{t("itemLabel", { id: o.itemId })}</td>
										<td>
											{sellers.get(o.userId) ??
												t("userLabel", { id: o.userId })}
										</td>
										<td style={{ fontWeight: 700 }}>
											{o.price.toLocaleString()} cr
										</td>
										<td
											className="muted"
											title={formatDate(new Date(o.timestamp * 1000))}
										>
											{listedAgo(o.timestamp, t)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</ContentCard>
		</section>
	);
}
