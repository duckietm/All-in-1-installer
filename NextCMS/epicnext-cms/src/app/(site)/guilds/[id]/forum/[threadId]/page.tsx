import { and, asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { replyToThread } from "@/actions/social";
import Link from "@/components/link";
import { PublicLoadError } from "@/components/public/load-error";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { auth } from "@/lib/auth";
import {
	db,
	Guilds,
	GuildsForumsComments,
	GuildsForumsThreads,
	User,
} from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { publicReadFailure } from "@/lib/services/public-read";

type SearchParams = Promise<{ replied?: string; error?: string }>;

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

export default async function GuildForumThreadPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string; threadId: string }>;
	searchParams: SearchParams;
}) {
	const t = await getTranslations("pages.guildForumThread");
	const { id, threadId: threadIdRaw } = await params;
	const { replied, error } = await searchParams;
	const guildId = Number(id);
	const threadId = Number(threadIdRaw);
	if (!Number.isInteger(guildId) || guildId <= 0) notFound();
	if (!Number.isInteger(threadId) || threadId <= 0) notFound();

	const session = await auth();
	const viewerId = Number(session?.user?.id);
	const isLoggedIn = Number.isInteger(viewerId) && viewerId > 0;

	let guild: { id: number; name: string } | null = null;
	let thread: {
		id: number;
		subject: string | null;
		locked: number | null;
		pinned: number | null;
		openerId: number | null;
	} | null = null;
	let postsFailed = false;
	let authorsFailed = false;
	let posts: {
		id: number;
		userId: number;
		message: string;
		createdAt: number;
	}[] = [];

	try {
		const [guildRow, threadRow] = await Promise.all([
			db
				.select({ id: Guilds.id, name: Guilds.name })
				.from(Guilds)
				.where(eq(Guilds.id, guildId))
				.limit(1)
				.then((rows) => rows[0] ?? null),
			db
				.select({
					id: GuildsForumsThreads.id,
					subject: GuildsForumsThreads.subject,
					locked: GuildsForumsThreads.locked,
					pinned: GuildsForumsThreads.pinned,
					openerId: GuildsForumsThreads.openerId,
				})
				.from(GuildsForumsThreads)
				.where(
					and(
						eq(GuildsForumsThreads.id, threadId),
						eq(GuildsForumsThreads.guildId, guildId),
						eq(GuildsForumsThreads.state, 0),
					),
				)
				.limit(1)
				.then((rows) => rows[0] ?? null),
		]);
		guild = guildRow;
		thread = threadRow;
	} catch (error) {
		publicReadFailure("guild.thread")(error);
		return (
			<section className="page-grid">
				<ContentCard>
					<PublicLoadError href={`/guilds/${guildId}/forum/${threadId}`} />
				</ContentCard>
			</section>
		);
	}

	if (!guild || !thread) notFound();

	try {
		posts = await db
			.select({
				id: GuildsForumsComments.id,
				userId: GuildsForumsComments.userId,
				message: GuildsForumsComments.message,
				createdAt: GuildsForumsComments.createdAt,
			})
			.from(GuildsForumsComments)
			.where(
				and(
					eq(GuildsForumsComments.threadId, thread.id),
					eq(GuildsForumsComments.state, 0),
				),
			)
			.orderBy(
				asc(GuildsForumsComments.createdAt),
				asc(GuildsForumsComments.id),
			);
	} catch (error) {
		publicReadFailure("guild.posts")(error);
		postsFailed = true;
		posts = [];
	}

	const authorIds = Array.from(
		new Set(posts.map((p) => p.userId).filter((v) => v > 0)),
	);
	let users: { id: number; username: string }[] = [];
	try {
		users = authorIds.length
			? await db
					.select({ id: User.id, username: User.username })
					.from(User)
					.where(inArray(User.id, authorIds))
			: [];
	} catch (error) {
		publicReadFailure("guild.post-authors")(error);
		authorsFailed = true;
		users = [];
	}
	const usernameById = new Map(users.map((u) => [u.id, u.username]));

	const isLocked = !!thread.locked;
	const canReply = isLoggedIn && !isLocked;

	const errorMessage =
		error === "invalid"
			? t("errors.invalid")
			: error === "not_found"
				? t("errors.notFound")
				: error === "locked"
					? t("errors.locked")
					: error === "ratelimit"
						? t("errors.ratelimit")
						: error
							? t("errors.error")
							: null;

	return (
		<section className="page-grid">
			{replied === "1" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.replied")}
				</div>
			) : null}
			{errorMessage ? (
				<div role="alert" style={feedbackStyle("error")}>
					{errorMessage}
				</div>
			) : null}

			<p style={{ margin: 0 }}>
				<Link href={`/guilds/${guild.id}/forum`}>{t("backToForum")}</Link>
			</p>

			<ContentCard
				icon="💬"
				title={thread.subject?.trim() || t("noSubject")}
				subtitle={t("inGuildForum", {
					guild: guild.name || t("unnamedGuild"),
				})}
			>
				<div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
					{thread.pinned ? (
						<span className="online-badge online">📌 {t("pinned")}</span>
					) : null}
					{isLocked ? (
						<span className="online-badge">🔒 {t("locked")}</span>
					) : null}
				</div>
			</ContentCard>

			<ContentCard
				icon="📝"
				title={t("postsTitle")}
				subtitle={
					postsFailed ? undefined : t("postsSubtitle", { count: posts.length })
				}
				padded={posts.length === 0 || authorsFailed}
			>
				{authorsFailed && (
					<PublicLoadError href={`/guilds/${guild.id}/forum/${thread.id}`} />
				)}
				{postsFailed ? (
					<PublicLoadError href={`/guilds/${guild.id}/forum/${thread.id}`} />
				) : posts.length === 0 ? (
					<EmptyState icon="📝">{t("postsEmpty")}</EmptyState>
				) : (
					<ul
						style={{
							listStyle: "none",
							margin: 0,
							padding: 0,
							display: "grid",
							gap: "1rem",
						}}
					>
						{posts.map((post) => {
							const username = usernameById.get(post.userId);
							return (
								<li
									key={post.id}
									style={{
										padding: "0.85rem 1rem",
										borderRadius: "var(--radius-md)",
										border: "1px solid var(--color-border, rgba(0,0,0,0.08))",
										background: "var(--color-surface)",
									}}
								>
									<div
										style={{
											display: "flex",
											flexWrap: "wrap",
											justifyContent: "space-between",
											gap: "0.35rem",
											marginBottom: "0.5rem",
										}}
									>
										<span style={{ fontWeight: 700 }}>
											{username ? (
												<Link href={`/u/${username}`}>{username}</Link>
											) : (
												<span className="muted">
													{t("userNumber", { id: post.userId })}
												</span>
											)}
										</span>
										<span className="muted" style={{ fontSize: "0.85rem" }}>
											{formatDate(
												post.createdAt ? new Date(post.createdAt * 1000) : null,
											)}
										</span>
									</div>
									<p
										style={{
											margin: 0,
											whiteSpace: "pre-wrap",
											wordBreak: "break-word",
										}}
									>
										{post.message}
									</p>
								</li>
							);
						})}
					</ul>
				)}
			</ContentCard>

			{canReply ? (
				<ContentCard
					icon="✍️"
					title={t("replyTitle")}
					subtitle={t("replySubtitle")}
				>
					<form action={replyToThread}>
						<input type="hidden" name="guildId" value={String(guild.id)} />
						<input type="hidden" name="threadId" value={String(thread.id)} />
						<textarea
							name="message"
							required
							rows={6}
							placeholder={t("replyPlaceholder")}
							style={{
								width: "100%",
								marginBottom: "0.75rem",
								resize: "vertical",
							}}
						/>
						<button type="submit" className="btn btn-primary">
							{t("replySubmit")}
						</button>
					</form>
				</ContentCard>
			) : isLocked ? (
				<p className="muted" style={{ margin: 0 }}>
					{t("lockedHint")}
				</p>
			) : (
				<p className="muted" style={{ margin: 0 }}>
					{t("loginToReply")} <Link href="/login">{t("loginLink")}</Link>
				</p>
			)}
		</section>
	);
}
