import { asc, eq, inArray, or } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { removeFriendship } from "@/actions/messenger";
import Link from "@/components/link";
import { ContentCard, EmptyState, OnlineBadge } from "@/components/public/ui";
import { UserAvatarThumbnail } from "@/components/shared/user-avatar-thumbnail";
import { auth } from "@/lib/auth";
import { db, MessengerFriendships, User } from "@/lib/db";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.friends");
	return {
		title: t("title"),
		description: t("emptySubtitle"),
		openGraph: {
			title: t("title"),
			description: t("emptySubtitle"),
			type: "website",
		},
	};
}

type SearchParams = Promise<{ removed?: string; error?: string }>;

function feedbackStyle(tone: "success" | "error"): CSSProperties {
	const accent =
		tone === "error" ? "var(--color-danger)" : "var(--color-primary)";
	return {
		margin: 0,
		padding: "0.85rem 1rem",
		borderRadius: "var(--radius-md)",
		border: `1px solid ${accent}`,
		color: "var(--color-text-readable, var(--color-text))",
		fontSize: "0.9rem",
		fontWeight: 600,
		background: "var(--color-surface)",
		borderLeft: `4px solid ${accent}`,
	};
}

export default async function FriendsPage({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	const t = await getTranslations("pages.friends");
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	const userId = Number(session.user.id);
	const { removed, error } = await searchParams;

	// Friendships are stored as TWO directional rows (user_one_id→user_two_id
	// and the reverse). Read both directions, then dedupe the friend ids.
	const friendships = await db
		.select({
			userOneId: MessengerFriendships.userOneId,
			userTwoId: MessengerFriendships.userTwoId,
		})
		.from(MessengerFriendships)
		.where(
			or(
				eq(MessengerFriendships.userOneId, userId),
				eq(MessengerFriendships.userTwoId, userId),
			),
		)
		.catch(() => []);

	const friendIds = Array.from(
		new Set(
			friendships
				.map((f) => (f.userOneId === userId ? f.userTwoId : f.userOneId))
				.filter((id) => id && id !== userId),
		),
	);

	const friends = friendIds.length
		? await db
				.select({
					id: User.id,
					username: User.username,
					look: User.look,
					motto: User.motto,
					online: User.online,
				})
				.from(User)
				.where(inArray(User.id, friendIds))
				.orderBy(asc(User.username))
				.catch(() => [])
		: [];

	const errorMessage =
		error === "not_found"
			? t("errors.notFound")
			: error === "invalid"
				? t("errors.invalid")
				: error
					? t("errors.error")
					: null;

	return (
		<section className="page-grid">
			{removed === "1" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.removed")}
				</div>
			) : null}
			{errorMessage ? (
				<div role="alert" style={feedbackStyle("error")}>
					{errorMessage}
				</div>
			) : null}

			<ContentCard
				icon="🤝"
				title={t("title")}
				subtitle={
					friends.length === 0
						? t("emptySubtitle")
						: t("subtitle", { count: friends.length })
				}
			/>

			<ContentCard padded={friends.length === 0}>
				{friends.length === 0 ? (
					<EmptyState icon="🤝">{t("emptyState")}</EmptyState>
				) : (
					<div className="card-grid sm-2 lg-3" style={{ padding: "1rem" }}>
						{friends.map((friend) => {
							const isOnline = friend.online === "1";
							return (
								<div
									key={friend.id}
									className="card hover"
									style={{
										display: "flex",
										gap: "0.85rem",
										alignItems: "center",
									}}
								>
									<UserAvatarThumbnail
										figure={friend.look}
										alt={`${friend.username} avatar`}
									/>
									<div style={{ minWidth: 0, flex: 1 }}>
										<h3 style={{ margin: "0 0 0.3rem", fontSize: "1rem" }}>
											<Link href={`/u/${friend.username}`}>
												{friend.username}
											</Link>
										</h3>
										<p
											className="muted"
											style={{
												margin: "0 0 0.4rem",
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
											}}
										>
											{friend.motto || t("noMotto")}
										</p>
										<OnlineBadge online={isOnline} />
									</div>
									<form action={removeFriendship}>
										<input
											type="hidden"
											name="friendId"
											value={String(friend.id)}
										/>
										<button type="submit" className="btn">
											{t("remove")}
										</button>
									</form>
								</div>
							);
						})}
					</div>
				)}
			</ContentCard>
		</section>
	);
}
