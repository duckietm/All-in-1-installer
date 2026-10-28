import { desc, eq, inArray, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import {
	acceptFriend,
	declineFriendRequest,
	sendOfflineMessage,
} from "@/actions/messenger";
import Link from "@/components/link";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { UserAvatarThumbnail } from "@/components/shared/user-avatar-thumbnail";
import { auth } from "@/lib/auth";
import {
	db,
	MessengerFriendrequests,
	MessengerFriendships,
	MessengerOffline,
	User,
} from "@/lib/db";
import { formatDate } from "@/lib/format-date";

type SearchParams = Promise<{
	accepted?: string;
	declined?: string;
	sent?: string;
	error?: string;
	send_error?: string;
}>;

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

export default async function MessagesPage({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	const t = await getTranslations("pages.messages");
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	const userId = Number(session.user.id);
	const { accepted, declined, sent, error, send_error } = await searchParams;

	let requests: { id: number; userFromId: number }[] = [];
	let messages: {
		id: number;
		userFromId: number;
		message: string;
		sendedOn: number;
	}[] = [];
	let friendships: { userOneId: number; userTwoId: number }[] = [];

	try {
		const [reqRows, msgRows, friendRows] = await Promise.all([
			db
				.select({
					id: MessengerFriendrequests.id,
					userFromId: MessengerFriendrequests.userFromId,
				})
				.from(MessengerFriendrequests)
				.where(eq(MessengerFriendrequests.userToId, userId))
				.orderBy(desc(MessengerFriendrequests.id))
				.limit(100),
			db
				.select({
					id: MessengerOffline.id,
					userFromId: MessengerOffline.userFromId,
					message: MessengerOffline.message,
					sendedOn: MessengerOffline.sendedOn,
				})
				.from(MessengerOffline)
				.where(eq(MessengerOffline.userId, userId))
				.orderBy(desc(MessengerOffline.sendedOn))
				.limit(50),
			db
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
				),
		]);
		requests = reqRows;
		messages = msgRows;
		friendships = friendRows;
	} catch {
		requests = [];
		messages = [];
		friendships = [];
	}

	const friendIds = Array.from(
		new Set(
			friendships.map((f) =>
				f.userOneId === userId ? f.userTwoId : f.userOneId,
			),
		),
	).filter((id) => id > 0 && id !== userId);

	const otherIds = Array.from(
		new Set([
			...requests.map((r) => r.userFromId),
			...messages.map((m) => m.userFromId),
			...friendIds,
		]),
	).filter((id) => id && id > 0);

	let userById = new Map<
		number,
		{ id: number; username: string; look: string }
	>();
	if (otherIds.length > 0) {
		try {
			const users = await db
				.select({
					id: User.id,
					username: User.username,
					look: User.look,
				})
				.from(User)
				.where(inArray(User.id, otherIds));
			userById = new Map(users.map((u) => [u.id, u]));
		} catch {
			userById = new Map();
		}
	}

	const friendsForSelect = friendIds
		.map((id) => userById.get(id))
		.filter((u): u is { id: number; username: string; look: string } =>
			Boolean(u),
		)
		.sort((a, b) => a.username.localeCompare(b.username));

	const errorMessage =
		error === "not_found"
			? t("errors.notFound")
			: error === "unauthorized"
				? t("errors.unauthorized")
				: error === "invalid"
					? t("errors.invalid")
					: error
						? t("errors.error")
						: null;

	const sendErrorMessage =
		send_error === "not_friend"
			? t("errors.notFriend")
			: send_error === "empty"
				? t("errors.emptyMessage")
				: send_error === "rate_limited"
					? t("errors.rateLimited")
					: send_error === "invalid"
						? t("errors.invalid")
						: send_error
							? t("errors.error")
							: null;

	return (
		<section className="page-grid">
			{accepted === "1" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.accepted")}
				</div>
			) : null}
			{declined === "1" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.declined")}
				</div>
			) : null}
			{sent === "1" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.sent")}
				</div>
			) : null}
			{errorMessage ? (
				<div role="alert" style={feedbackStyle("error")}>
					{errorMessage}
				</div>
			) : null}
			{sendErrorMessage ? (
				<div role="alert" style={feedbackStyle("error")}>
					{sendErrorMessage}
				</div>
			) : null}

			<ContentCard icon="✉️" title={t("title")} subtitle={t("subtitle")} />

			<ContentCard
				icon="📤"
				title={t("composeTitle")}
				subtitle={t("composeSubtitle")}
				padded={friendsForSelect.length === 0}
			>
				{friendsForSelect.length === 0 ? (
					<EmptyState icon="👥">{t("composeEmptyFriends")}</EmptyState>
				) : (
					<form
						action={sendOfflineMessage}
						className="grid"
						style={{ padding: "1rem", gap: "0.75rem", maxWidth: "36rem" }}
					>
						<label className="grid" style={{ gap: "0.35rem" }}>
							<span className="muted">{t("composeFriendLabel")}</span>
							<select name="friendId" required defaultValue="">
								<option value="" disabled>
									{t("composeFriendPlaceholder")}
								</option>
								{friendsForSelect.map((friend) => (
									<option key={friend.id} value={String(friend.id)}>
										{friend.username}
									</option>
								))}
							</select>
						</label>
						<label className="grid" style={{ gap: "0.35rem" }}>
							<span className="muted">{t("composeMessageLabel")}</span>
							<textarea
								name="message"
								required
								maxLength={500}
								rows={4}
								placeholder={t("composeMessagePlaceholder")}
								style={{ resize: "vertical" }}
							/>
						</label>
						<div>
							<button type="submit" className="btn btn-secondary">
								{t("composeSend")}
							</button>
						</div>
					</form>
				)}
			</ContentCard>

			{/* ── Pending friend requests ───────────────────────────── */}
			<ContentCard
				icon="🙋"
				title={t("requestsTitle")}
				subtitle={
					requests.length === 0
						? t("requestsEmptySubtitle")
						: t("requestsSubtitle", { count: requests.length })
				}
				padded={requests.length === 0}
			>
				{requests.length === 0 ? (
					<EmptyState icon="🙋">{t("requestsEmptyState")}</EmptyState>
				) : (
					<div className="grid" style={{ padding: "1rem", gap: "0.75rem" }}>
						{requests.map((req) => {
							const from = userById.get(req.userFromId);
							return (
								<div
									key={req.id}
									className="card"
									style={{
										display: "flex",
										gap: "0.85rem",
										alignItems: "center",
									}}
								>
									<UserAvatarThumbnail
										figure={from?.look ?? ""}
										alt={`${from?.username ?? "User"} avatar`}
									/>
									<div style={{ minWidth: 0, flex: 1 }}>
										<p style={{ margin: 0 }}>
											{from ? (
												<Link href={`/u/${from.username}`}>
													<strong>{from.username}</strong>
												</Link>
											) : (
												<strong>
													{t("unknownUser", { id: req.userFromId })}
												</strong>
											)}
										</p>
										<p className="muted" style={{ margin: 0 }}>
											{t("wantsToBeFriend")}
										</p>
									</div>
									<div
										style={{
											display: "flex",
											gap: "0.5rem",
											flexWrap: "wrap",
										}}
									>
										<form action={acceptFriend}>
											<input
												type="hidden"
												name="requestId"
												value={String(req.id)}
											/>
											<button type="submit" className="btn btn-secondary">
												{t("accept")}
											</button>
										</form>
										<form action={declineFriendRequest}>
											<input
												type="hidden"
												name="requestId"
												value={String(req.id)}
											/>
											<button type="submit" className="btn">
												{t("decline")}
											</button>
										</form>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</ContentCard>

			{/* ── Offline messages ──────────────────────────────────── */}
			<ContentCard
				icon="💬"
				title={t("offlineTitle")}
				subtitle={
					messages.length === 0
						? t("offlineEmptySubtitle")
						: t("offlineSubtitle", { count: messages.length })
				}
				padded={messages.length === 0}
			>
				{messages.length === 0 ? (
					<EmptyState icon="💬">{t("offlineEmptyState")}</EmptyState>
				) : (
					<div className="grid" style={{ padding: "1rem", gap: "0.75rem" }}>
						{messages.map((msg) => {
							const from = userById.get(msg.userFromId);
							const when = formatDate(new Date(msg.sendedOn * 1000));
							return (
								<article
									key={msg.id}
									className="card"
									style={{
										display: "flex",
										gap: "0.85rem",
										alignItems: "flex-start",
									}}
								>
									<UserAvatarThumbnail
										figure={from?.look ?? ""}
										alt={`${from?.username ?? "User"} avatar`}
									/>
									<div style={{ minWidth: 0, flex: 1 }}>
										<p
											className="muted"
											style={{ marginTop: 0, marginBottom: "0.35rem" }}
										>
											{from ? (
												<Link href={`/u/${from.username}`}>
													{from.username}
												</Link>
											) : (
												<span>{t("unknownUser", { id: msg.userFromId })}</span>
											)}
											{when ? <span> · {when}</span> : null}
										</p>
										<p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
											{msg.message}
										</p>
									</div>
								</article>
							);
						})}
					</div>
				)}
			</ContentCard>
		</section>
	);
}
