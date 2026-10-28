import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { postGuestbook } from "@/actions/guestbook";
import { sendFriendRequest } from "@/actions/social";
import Link from "@/components/link";
import { ContentCard, EmptyState, OnlineBadge } from "@/components/public/ui";
import { CurrencyIcon } from "@/components/shared/currency-icon";
import { ProfileImage } from "@/components/shared/profile-image";
import { UserAvatarThumbnail } from "@/components/shared/user-avatar-thumbnail";
import { auth } from "@/lib/auth";
import {
	CameraWeb,
	db,
	MessengerFriendrequests,
	MessengerFriendships,
	Rooms,
	User,
	UsersBadges,
	UsersCurrency,
	WebsiteBadges,
	WebsiteUserGuestbooks,
} from "@/lib/db";
import { avatarImageUrl } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import { withPublicPagePerformance } from "@/lib/public-page-performance";
import { loadProfilePrivacy } from "@/lib/services/profile-privacy";
import { ProfilePhotoGallery } from "./ProfilePhotoGallery";
import styles from "./profile.module.css";

type SearchParams = Promise<{
	friend?: string;
	guestbook?: string;
	error?: string;
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

export async function generateMetadata({
	params,
}: {
	params: Promise<{ username: string }>;
}): Promise<Metadata> {
	const { username } = await params;
	const [user] = await db
		.select({ username: User.username, motto: User.motto })
		.from(User)
		.where(eq(User.username, username))
		.limit(1)
		.catch(() => []);
	if (!user) return { title: "Profile" };
	return {
		title: user.username,
		description: user.motto || `${user.username}'s profile`,
	};
}

// Badge codes (e.g. "ADM") map to a .gif served through the cached proxy.
const BADGE_IMG_BASE = "/cms_api/imaging/badge?code";

// Emulator currency type ids (see UsersCurrency model): Duckets=0, Diamonds=5.
const CURRENCY_DUCKETS = 0;
const CURRENCY_DIAMONDS = 5;

async function ProfilePage({
	params,
	searchParams,
}: {
	params: Promise<{ username: string }>;
	searchParams: SearchParams;
}) {
	const t = await getTranslations("pages.profile");
	const { username } = await params;
	const { friend, guestbook: guestbookStatus, error } = await searchParams;

	const [userRows, session] = await Promise.all([
		db
			.select({
				id: User.id,
				username: User.username,
				motto: User.motto,
				look: User.look,
				credits: User.credits,
				online: User.online,
				accountCreated: User.accountCreated,
			})
			.from(User)
			.where(eq(User.username, username))
			.limit(1),
		auth(),
	]);
	const user = userRows[0] ?? null;

	if (!user) notFound();

	const avatar = avatarImageUrl(user.look);
	const registered = formatDate(new Date(user.accountCreated * 1000), "date");
	const meId = Number(session?.user?.id);
	const isLoggedIn = Number.isInteger(meId) && meId > 0;
	const isSelf = isLoggedIn && meId === user.id;
	const privacy = await loadProfilePrivacy(user.id);
	const visible = (key: keyof typeof privacy.values) =>
		isSelf || privacy.values[key];

	// Friend / request state relative to the signed-in viewer (if any).
	let isFriend = false;
	let outgoingPending = false;
	let incomingPending = false;
	if (isLoggedIn && !isSelf) {
		const [friendshipRows, outgoingRows, incomingRows] = await Promise.all([
			db
				.select({ id: MessengerFriendships.id })
				.from(MessengerFriendships)
				.where(
					or(
						and(
							eq(MessengerFriendships.userOneId, meId),
							eq(MessengerFriendships.userTwoId, user.id),
						),
						and(
							eq(MessengerFriendships.userOneId, user.id),
							eq(MessengerFriendships.userTwoId, meId),
						),
					),
				)
				.limit(1)
				.catch(() => []),
			db
				.select({ id: MessengerFriendrequests.id })
				.from(MessengerFriendrequests)
				.where(
					and(
						eq(MessengerFriendrequests.userFromId, meId),
						eq(MessengerFriendrequests.userToId, user.id),
					),
				)
				.limit(1)
				.catch(() => []),
			db
				.select({ id: MessengerFriendrequests.id })
				.from(MessengerFriendrequests)
				.where(
					and(
						eq(MessengerFriendrequests.userFromId, user.id),
						eq(MessengerFriendrequests.userToId, meId),
					),
				)
				.limit(1)
				.catch(() => []),
		]);
		isFriend = Boolean(friendshipRows[0]);
		outgoingPending = Boolean(outgoingRows[0]);
		incomingPending = Boolean(incomingRows[0]);
	}

	const feedbackErrorMessage =
		error === "self"
			? t("errors.self")
			: error === "already_friends"
				? t("errors.alreadyFriends")
				: error === "already_pending"
					? t("errors.alreadyPending")
					: error === "incoming_pending"
						? t("errors.incomingPending")
						: error === "empty"
							? t("errors.empty")
							: error === "moderated"
								? t("errors.moderated")
								: error === "ratelimit"
									? t("errors.ratelimit")
									: error === "invalid"
										? t("errors.invalid")
										: error
											? t("errors.error")
											: null;

	// Profile sub-sections. Each query is isolated so a DB hiccup degrades that
	// single section to empty rather than 500-ing the whole profile.

	// Currency ledger rows (duckets/diamonds). Credits live on the users row
	// itself; the alt-currencies sit in the users_currency ledger keyed by type.
	// Currency ledger rows (duckets/diamonds). Credits live on the users row
	// itself; the alt-currencies sit in the users_currency ledger keyed by type.
	// All sub-sections run in parallel (each query keeps its own .catch so a DB
	// hiccup still degrades only that section instead of 500-ing the profile).
	const [currencyRows, friendships, rooms, badges, photoRows, guestbook] =
		await Promise.all([
			visible("wallet")
				? db
						.select({
							type: UsersCurrency.type,
							amount: UsersCurrency.amount,
						})
						.from(UsersCurrency)
						.where(
							and(
								eq(UsersCurrency.userId, user.id),
								inArray(UsersCurrency.type, [
									CURRENCY_DUCKETS,
									CURRENCY_DIAMONDS,
								]),
							),
						)
						.catch(() => [])
				: Promise.resolve([]),
			// Friends. messenger_friendships stores one directed row per pair
			// keyed on user_one_id; resolve the user_two_id side below.
			visible("friends")
				? db
						.select({ userTwoId: MessengerFriendships.userTwoId })
						.from(MessengerFriendships)
						.where(eq(MessengerFriendships.userOneId, user.id))
						.orderBy(desc(MessengerFriendships.friendsSince))
						.limit(18)
						.catch(() => [])
				: Promise.resolve([]),
			// Rooms owned by this user.
			db
				.select({
					id: Rooms.id,
					name: Rooms.name,
					users: Rooms.users,
					usersMax: Rooms.usersMax,
					state: Rooms.state,
				})
				.from(Rooms)
				.where(eq(Rooms.ownerId, user.id))
				.orderBy(desc(Rooms.users))
				.limit(8)
				.catch(() => []),
			db
				.select()
				.from(UsersBadges)
				.where(eq(UsersBadges.userId, user.id))
				.orderBy(asc(UsersBadges.slotId))
				.catch(() => []),
			visible("photos")
				? db
						.select()
						.from(CameraWeb)
						.where(eq(CameraWeb.userId, user.id))
						.orderBy(desc(CameraWeb.timestamp))
						.limit(24)
						.catch(() => [])
				: Promise.resolve([]),
			db
				.select()
				.from(WebsiteUserGuestbooks)
				.where(eq(WebsiteUserGuestbooks.profileId, user.id))
				.orderBy(desc(WebsiteUserGuestbooks.createdAt))
				.limit(30)
				.catch(() => []),
		]);
	const photos = photoRows ?? [];
	const ducketsAmount =
		currencyRows.find((c) => c.type === CURRENCY_DUCKETS)?.amount ?? 0;
	const diamondsAmount =
		currencyRows.find((c) => c.type === CURRENCY_DIAMONDS)?.amount ?? 0;
	const wallet = [
		{
			key: "credits",
			label: t("statCredits"),
			value: user.credits,
		},
		{
			key: "duckets",
			label: t("statDuckets"),
			value: ducketsAmount,
		},
		{
			key: "diamonds",
			label: t("statDiamonds"),
			value: diamondsAmount,
		},
	] as const;

	// Resolve friend usernames/looks and the guestbook author usernames/looks in
	// parallel queries (the ids come from the queries above).
	const friendIds = Array.from(new Set(friendships.map((f) => f.userTwoId)));
	const authorIds = Array.from(new Set(guestbook.map((g) => g.userId)));
	const [friendUsers, authors, badgeDetails] = await Promise.all([
		friendIds.length
			? db
					.select({
						id: User.id,
						username: User.username,
						look: User.look,
					})
					.from(User)
					.where(inArray(User.id, friendIds))
					.catch(() => [])
			: [],
		authorIds.length
			? db
					.select({
						id: User.id,
						username: User.username,
						look: User.look,
					})
					.from(User)
					.where(inArray(User.id, authorIds))
					.catch(() => [])
			: [],
		badges.length
			? db
					.select()
					.from(WebsiteBadges)
					.where(
						inArray(
							WebsiteBadges.badgeKey,
							badges.map((b) => b.badgeCode),
						),
					)
					.catch(() => [])
			: [],
	]);
	const friendById = new Map(friendUsers.map((f) => [f.id, f]));
	const friends = friendships
		.map((f) => friendById.get(f.userTwoId))
		.filter((f): f is NonNullable<typeof f> => Boolean(f));
	const authorById = new Map(authors.map((a) => [a.id, a]));
	const badgeByCode = new Map(badgeDetails.map((b) => [b.badgeKey, b]));

	return (
		<section className={`page-grid ${styles.profile}`}>
			{friend === "sent" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.sent")}
				</div>
			) : null}
			{guestbookStatus === "posted" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.guestbook")}
				</div>
			) : null}
			{feedbackErrorMessage ? (
				<div role="alert" style={feedbackStyle("error")}>
					{feedbackErrorMessage}
				</div>
			) : null}

			{/* ── Profile header ──────────────────── */}
			<ContentCard padded={false} className={styles.hero}>
				<div
					className="content-card-body"
					style={{
						display: "flex",
						gap: "1.5rem",
						alignItems: "center",
						flexWrap: "wrap",
					}}
				>
					<ProfileImage
						src={avatar}
						alt={user.username}
						width={100}
						height={150}
						className={styles.avatar}
						loading="eager"
						fetchPriority="high"
					/>
					<div className={styles.identity}>
						<h1 style={{ margin: "0 0 0.25rem" }}>{user.username}</h1>
						<p style={{ margin: "0 0 0.6rem" }}>
							{user.motto || <span className="muted">{t("noMotto")}</span>}
						</p>
						<div className={styles.meta}>
							{visible("online") && (
								<OnlineBadge online={user.online === "1"} />
							)}
							{visible("registered") && (
								<span>
									{t("statRegistered")}: {registered}
								</span>
							)}
						</div>
					</div>
					{isLoggedIn && !isSelf ? (
						<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
							{isFriend ? (
								<span className="muted" style={{ fontWeight: 600 }}>
									{t("alreadyFriends")}
								</span>
							) : outgoingPending ? (
								<span className="muted" style={{ fontWeight: 600 }}>
									{t("requestPending")}
								</span>
							) : incomingPending ? (
								<Link href="/messages" className="btn btn-secondary">
									{t("respondInMessages")}
								</Link>
							) : (
								<form action={sendFriendRequest}>
									<input type="hidden" name="userId" value={String(user.id)} />
									<input type="hidden" name="username" value={user.username} />
									<button type="submit" className="btn btn-primary">
										{t("addFriend")}
									</button>
								</form>
							)}
						</div>
					) : null}
				</div>
			</ContentCard>

			<div className={styles.columns}>
				<aside className={styles.sidebar}>
					{isSelf && (
						<p className="muted">
							{t("privacy.ownerHint")}{" "}
							<Link href="/settings#profile-privacy">{t("privacy.title")}</Link>
						</p>
					)}
					{/* Wallet */}
					{visible("wallet") && (
						<ContentCard title={t("walletTitle")}>
							<div className={styles.wallet}>
								{wallet.map((w) => (
									<div key={w.key} className={styles.currency}>
										<CurrencyIcon kind={w.key} size={28} alt="" />
										<div>
											<strong>{w.value.toLocaleString()}</strong>
											<span className="muted">{w.label}</span>
										</div>
									</div>
								))}
							</div>
						</ContentCard>
					)}

					{/* ── Friends ──────────────────────── */}
					{visible("friends") && (
						<details className={styles.more}>
							<summary>{t("friendsTitle")}</summary>
							<ContentCard
								icon="👥"
								title={t("friendsTitle")}
								subtitle={t("friendsSubtitle", { count: friends.length })}
								padded={true}
							>
								{friends.length === 0 ? (
									<EmptyState icon="👥">{t("friendsEmpty")}</EmptyState>
								) : (
									<div
										style={{
											display: "grid",
											gridTemplateColumns:
												"repeat(auto-fill, minmax(72px, 1fr))",
											gap: "0.75rem",
										}}
									>
										{friends.map((f) => (
											<Link
												key={f.id}
												href={`/u/${encodeURIComponent(f.username)}`}
												className="card"
												title={f.username}
												style={{
													display: "flex",
													flexDirection: "column",
													alignItems: "center",
													gap: "0.35rem",
													padding: "0.6rem 0.4rem",
													textAlign: "center",
												}}
											>
												<UserAvatarThumbnail figure={f.look} alt={f.username} />
												<span
													style={{
														fontSize: "0.8rem",
														fontWeight: 600,
														maxWidth: "100%",
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap",
													}}
												>
													{f.username}
												</span>
											</Link>
										))}
									</div>
								)}
							</ContentCard>
						</details>
					)}
					{/* Badges */}
					<details className={styles.more}>
						<summary>{t("badgesTitle")}</summary>
						<ContentCard icon="🏅" title={t("badgesTitle")}>
							{badges.length === 0 ? (
								<EmptyState icon="🏅">{t("badgesEmpty")}</EmptyState>
							) : (
								<div className={styles.badges}>
									{badges.map((b) => {
										const details = badgeByCode.get(b.badgeCode);
										const name = details?.badgeName || b.badgeCode;
										return (
											<details key={b.id} className={styles.badge}>
												<summary title={name}>
													<img
														src={`${BADGE_IMG_BASE}=${encodeURIComponent(b.badgeCode)}`}
														alt={name}
														width={40}
														height={40}
														loading="lazy"
													/>
												</summary>
												<div className={styles.badgeInfo}>
													<strong>{name}</strong>
													{details?.badgeDescription && (
														<p>{details.badgeDescription}</p>
													)}
													<small>{b.badgeCode}</small>
												</div>
											</details>
										);
									})}
								</div>
							)}
						</ContentCard>
					</details>
				</aside>
				<div className={styles.content}>
					{/* Rooms */}
					<ContentCard
						icon="🏠"
						title={t("roomsTitle")}
						subtitle={t("roomsSubtitle", { username: user.username })}
					>
						{rooms.length === 0 ? (
							<EmptyState icon="🏠">{t("roomsEmpty")}</EmptyState>
						) : (
							<div className={styles.rooms}>
								{rooms.map((r) => {
									const photo = photos.find((photo) => photo.roomId === r.id);
									return (
										<Link
											href={`/room/${r.id}`}
											key={r.id}
											className={styles.room}
										>
											<ProfileImage
												src={
													photo?.url ||
													"/assets/images/profile/room_placeholder.png"
												}
												fallback="/assets/images/profile/room_placeholder.png"
												alt=""
												width={320}
												height={140}
												className={styles.roomImage}
											/>
											<div className={styles.roomBody}>
												<strong>{r.name || t("roomUntitled")}</strong>
												{!photo && (
													<span className="muted">{t("noRoomPreview")}</span>
												)}
												<div className={styles.roomMeta}>
													<span>
														{r.users}/{r.usersMax}
													</span>
													<span>
														{t.has(`roomStates.${r.state}`)
															? t(`roomStates.${r.state}`)
															: r.state}
													</span>
												</div>
												<span className={styles.roomLink}>
													{t("viewRoom")} →
												</span>
											</div>
										</Link>
									);
								})}
							</div>
						)}
					</ContentCard>

					{visible("photos") && (
						<ContentCard icon="📸" title={t("photosTitle")}>
							{photoRows === null ? (
								<p role="status">{t("photosUnavailable")}</p>
							) : photos.length === 0 ? (
								<EmptyState icon="📸">{t("photosEmpty")}</EmptyState>
							) : (
								<ProfilePhotoGallery
									photos={photos}
									username={user.username}
									moreLabel={t("morePhotos")}
									openLabel={t("openPhoto")}
								/>
							)}
						</ContentCard>
					)}
					{/* ── Guestbook ───────────────────── */}
					<ContentCard
						icon="📝"
						title={t("guestbookTitle")}
						subtitle={t("guestbookSubtitle", { username: user.username })}
					>
						{isLoggedIn ? (
							<form
								action={postGuestbook}
								className="card"
								style={{ marginBottom: "1rem" }}
							>
								{/* Profile owner id drives the write target; the author is taken from
                the session inside the action, never from this form. */}
								<input type="hidden" name="profileId" value={String(user.id)} />
								<input type="hidden" name="username" value={user.username} />
								<label htmlFor="gb-message" className="muted">
									{t("leaveMessage")}
								</label>
								<textarea
									id="gb-message"
									name="message"
									required
									maxLength={255}
									rows={3}
									placeholder={t("guestbookPlaceholder", {
										username: user.username,
									})}
									style={{
										width: "100%",
										margin: "0.4rem 0 0.75rem",
										resize: "vertical",
									}}
								/>
								<button type="submit" className="btn btn-primary">
									{t("post")}
								</button>
							</form>
						) : (
							<p className="muted">{t("loginToPost")}</p>
						)}

						{guestbook.length === 0 ? (
							<EmptyState icon="📝">{t("guestbookEmpty")}</EmptyState>
						) : (
							<div className="grid" style={{ gap: "0.75rem" }}>
								{guestbook.map((g) => {
									const author = authorById.get(g.userId);
									return (
										<div
											key={String(g.id)}
											className="card"
											style={{
												display: "flex",
												gap: "0.75rem",
												alignItems: "flex-start",
											}}
										>
											{author ? (
												<UserAvatarThumbnail
													figure={author.look}
													alt={author?.username ?? "author"}
												/>
											) : null}
											<div style={{ flex: 1 }}>
												<p style={{ margin: "0 0 0.25rem" }}>
													<strong>
														{author?.username ??
															t("unknownUser", { id: g.userId })}
													</strong>{" "}
													<span className="muted">
														{formatDate(g.createdAt, "date", "")}
													</span>
												</p>
												<p style={{ margin: 0 }}>{g.message}</p>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</ContentCard>
				</div>
			</div>
		</section>
	);
}

export default withPublicPagePerformance("/u/[username]", ProfilePage);
