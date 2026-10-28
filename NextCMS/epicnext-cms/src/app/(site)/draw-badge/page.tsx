import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buyBadge } from "@/actions/draw-badge";
import { ContentCard, EmptyState, StatBlock } from "@/components/public/ui";
import { CurrencyIcon } from "@/components/shared/currency-icon";
import { auth } from "@/lib/auth";
import { db, User, WebsiteDrawbadges } from "@/lib/db";
import { siteSettings } from "@/lib/services/site-settings";

// Reads the live users + website_drawbadges tables and writes credits/badges on
// purchase — must never be statically rendered.

export const metadata: Metadata = {
	title: "Draw a Badge",
	description: "Draw a random badge and add it to your collection.",
	openGraph: {
		title: "Draw a Badge",
		description: "Draw a random badge and add it to your collection.",
		type: "website",
	},
};

const DEFAULT_PRICE = 50;

type DrawBadge = {
	id: bigint;
	badgeUrl: string;
	badgeName: string;
	badgeDesc: string;
};

const BOUGHT_NOTE = (code: string) =>
	`Badge "${code}" has been added to your inventory. Enjoy!`;

const ERROR_NOTE: Record<string, string> = {
	invalid: "That badge is no longer available.",
	credits: "You don't have enough credits to buy this badge.",
	ratelimit: "You're purchasing too fast. Please wait a moment and try again.",
	fail: "Something went wrong. Please try again.",
};

function getErrorNote(error: string): string {
	if (error === "invalid") return ERROR_NOTE.invalid;
	if (error === "credits") return ERROR_NOTE.credits;
	if (error === "ratelimit") return ERROR_NOTE.ratelimit;
	return ERROR_NOTE.fail;
}

export default async function DrawBadgePage({
	searchParams,
}: {
	// Next 16: searchParams is a Promise.
	searchParams: Promise<{ bought?: string; error?: string }>;
}) {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	const { bought = "", error = "" } = await searchParams;

	// Resolve the flat purchase price + the buyer's balance + the published
	// badges, all fail-soft so the page still renders if the DB is unreachable.
	let price = DEFAULT_PRICE;
	let credits = 0;
	let badges: DrawBadge[] = [];

	try {
		const raw = await siteSettings.get(
			"drawbadge.price",
			String(DEFAULT_PRICE),
		);
		const n = Number(raw);
		if (Number.isFinite(n) && n >= 0) price = Math.floor(n);
	} catch {
		price = DEFAULT_PRICE;
	}

	try {
		const [buyer] = await db
			.select({ credits: User.credits })
			.from(User)
			.where(eq(User.id, Number(session.user.id)))
			.limit(1);
		credits = buyer?.credits ?? 0;
	} catch {
		credits = 0;
	}

	try {
		badges = await db
			.select({
				id: WebsiteDrawbadges.id,
				badgeUrl: WebsiteDrawbadges.badgeUrl,
				badgeName: WebsiteDrawbadges.badgeName,
				badgeDesc: WebsiteDrawbadges.badgeDesc,
			})
			.from(WebsiteDrawbadges)
			.where(eq(WebsiteDrawbadges.published, true))
			.orderBy(desc(WebsiteDrawbadges.id));
	} catch {
		badges = [];
	}

	return (
		<section className="page-grid">
			<ContentCard
				icon="🎨"
				title="Draw a Badge"
				subtitle="Buy a community-designed badge and wear it on your profile."
			>
				<div className="stat-grid">
					<StatBlock
						value={credits.toLocaleString()}
						label="Your credits"
						icon="🪙"
					/>
					<StatBlock
						value={price.toLocaleString()}
						label="Price per badge"
						icon="🏷️"
					/>
				</div>

				{bought ? (
					<p
						role="status"
						aria-live="polite"
						style={{
							margin: "1rem 0 0",
							fontWeight: 700,
							color: "var(--color-secondary-hover)",
						}}
					>
						{BOUGHT_NOTE(bought)}
					</p>
				) : null}
				{error ? (
					<p
						role="alert"
						style={{
							margin: "1rem 0 0",
							fontWeight: 700,
							color: "var(--color-danger)",
						}}
					>
						{getErrorNote(error)}
					</p>
				) : null}
			</ContentCard>

			<ContentCard
				icon="🏅"
				title="Available badges"
				subtitle={
					badges.length > 0 ? `${badges.length} badge(s) available` : undefined
				}
				padded={badges.length === 0}
			>
				{badges.length === 0 ? (
					<EmptyState icon="🎨">
						No badges have been published yet. Check back soon!
					</EmptyState>
				) : (
					<div className="card-grid sm-2 lg-3" style={{ padding: "1rem" }}>
						{badges.map((b) => {
							const affordable = credits >= price;
							return (
								<article key={String(b.id)} className="card hover">
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "0.75rem",
											marginBottom: "0.6rem",
										}}
									>
										<div
											style={{
												width: 56,
												height: 56,
												borderRadius: "var(--radius-sm)",
												display: "grid",
												placeItems: "center",
												background: "#f8fafc",
												border: "2px solid var(--border-color)",
												flexShrink: 0,
												overflow: "hidden",
											}}
										>
											{b.badgeUrl ? (
												// Badge images are arbitrary external URLs stored by the
												// draw-badge tool, so a plain <img> is correct here.
												<img
													src={b.badgeUrl}
													alt=""
													width={40}
													height={40}
													style={{ objectFit: "contain", display: "block" }}
												/>
											) : null}
										</div>
										<div style={{ minWidth: 0 }}>
											<h3 style={{ margin: 0 }}>{b.badgeName}</h3>
											<span className="currency">
												<CurrencyIcon kind="credits" size={22} alt="" />
												{price.toLocaleString()}
											</span>
										</div>
									</div>

									{b.badgeDesc ? (
										<p style={{ margin: "0 0 0.85rem" }}>{b.badgeDesc}</p>
									) : null}

									<form action={buyBadge}>
										<input type="hidden" name="id" value={String(b.id)} />
										<button
											type="submit"
											className="btn btn-primary"
											style={{ width: "100%" }}
											disabled={!affordable}
											aria-disabled={!affordable}
										>
											{affordable ? "Buy badge" : "Not enough credits"}
										</button>
									</form>
								</article>
							);
						})}
					</div>
				)}
			</ContentCard>
		</section>
	);
}
