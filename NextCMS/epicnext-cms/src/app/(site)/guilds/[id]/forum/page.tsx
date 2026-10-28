import { and, desc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import Link from "@/components/link";
import { PublicLoadError } from "@/components/public/load-error";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { db, Guilds, GuildsForumsThreads, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { publicReadFailure } from "@/lib/services/public-read";

type SearchParams = Promise<{ posted?: string }>;

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

type ThreadRow = {
	id: number;
	openerId: number | null;
	subject: string | null;
	postsCount: number | null;
	createdAt: number | null;
	updatedAt: number | null;
	pinned: number | null;
	locked: number | null;
};

export default async function GuildForumPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: SearchParams;
}) {
	const t = await getTranslations("pages.guildForum");
	const { id } = await params;
	const { posted } = await searchParams;
	const guildId = Number(id);
	if (!Number.isInteger(guildId) || guildId <= 0) notFound();

	// Missing guilds and unavailable guild data have distinct outcomes.
	let guild: { id: number; name: string; badge: string } | null = null;
	try {
		const [row] = await db
			.select({
				id: Guilds.id,
				name: Guilds.name,
				badge: Guilds.badge,
			})
			.from(Guilds)
			.where(eq(Guilds.id, guildId))
			.limit(1);
		guild = row ?? null;
	} catch (error) {
		publicReadFailure("guild.forum")(error);
		return (
			<section className="page-grid">
				<ContentCard>
					<PublicLoadError href={`/guilds/${guildId}/forum`} />
				</ContentCard>
			</section>
		);
	}

	if (!guild) notFound();

	// Threads for this guild. Pinned first, then most-recently active.
	let threadsFailed = false;
	let authorsFailed = false;
	let threads: ThreadRow[] = [];
	try {
		threads = await db
			.select({
				id: GuildsForumsThreads.id,
				openerId: GuildsForumsThreads.openerId,
				subject: GuildsForumsThreads.subject,
				postsCount: GuildsForumsThreads.postsCount,
				createdAt: GuildsForumsThreads.createdAt,
				updatedAt: GuildsForumsThreads.updatedAt,
				pinned: GuildsForumsThreads.pinned,
				locked: GuildsForumsThreads.locked,
			})
			.from(GuildsForumsThreads)
			.where(
				and(
					eq(GuildsForumsThreads.guildId, guild.id),
					eq(GuildsForumsThreads.state, 0),
				),
			)
			.orderBy(
				desc(GuildsForumsThreads.pinned),
				desc(GuildsForumsThreads.updatedAt),
				desc(GuildsForumsThreads.id),
			)
			.limit(100);
	} catch (error) {
		publicReadFailure("guild.threads")(error);
		threadsFailed = true;
		threads = [];
	}

	// Resolve opener usernames in one query (no relation exists in the schema, so
	// join the users table manually by id). Falls back to the raw author id.
	const openerIds = Array.from(
		new Set(threads.map((t2) => t2.openerId ?? 0).filter((v) => v > 0)),
	);

	let users: { id: number; username: string }[] = [];
	try {
		users = openerIds.length
			? await db
					.select({ id: User.id, username: User.username })
					.from(User)
					.where(inArray(User.id, openerIds))
			: [];
	} catch (error) {
		publicReadFailure("guild.thread-authors")(error);
		authorsFailed = true;
		users = [];
	}

	const usernameById = new Map(users.map((u) => [u.id, u.username]));

	return (
		<section className="page-grid">
			{posted === "1" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.posted")}
				</div>
			) : null}

			<p style={{ margin: 0 }}>
				<Link href={`/guilds/${guild.id}`}>{t("backToGuild")}</Link>
			</p>

			<ContentCard
				icon="🗣️"
				title={t("forumTitle", { guild: guild.name || t("unnamedGuild") })}
				subtitle={
					threadsFailed
						? undefined
						: `${threads.length} ${threads.length === 1 ? t("threadSingular") : t("threadPlural")}`
				}
				action={
					<Link
						href={`/guilds/${guild.id}/forum/new`}
						className="btn btn-primary"
					>
						{t("newThread")}
					</Link>
				}
			/>

			<ContentCard padded={threads.length === 0 || authorsFailed}>
				{authorsFailed && (
					<PublicLoadError href={`/guilds/${guild.id}/forum`} />
				)}
				{threadsFailed ? (
					<PublicLoadError href={`/guilds/${guild.id}/forum`} />
				) : threads.length === 0 ? (
					<EmptyState icon="🗣️">{t("empty")}</EmptyState>
				) : (
					<table>
						<thead>
							<tr>
								<th style={{ padding: "0.6rem 0.75rem" }}>{t("colSubject")}</th>
								<th style={{ padding: "0.6rem 0.75rem" }}>{t("colAuthor")}</th>
								<th style={{ padding: "0.6rem 0.75rem" }}>{t("colPosts")}</th>
								<th style={{ padding: "0.6rem 0.75rem" }}>{t("colDate")}</th>
							</tr>
						</thead>
						<tbody>
							{threads.map((t2) => {
								const opener = t2.openerId ?? 0;
								const username =
									opener > 0 ? usernameById.get(opener) : undefined;
								return (
									<tr key={t2.id}>
										<td style={{ padding: "0.6rem 0.75rem" }}>
											<Link
												href={`/guilds/${guild.id}/forum/${t2.id}`}
												style={{ fontWeight: 700 }}
											>
												{t2.subject?.trim() || t("noSubject")}
											</Link>
											{t2.pinned ? (
												<span
													className="online-badge online"
													style={{ marginLeft: "0.5rem" }}
												>
													📌 {t("pinned")}
												</span>
											) : null}
											{t2.locked ? (
												<span
													className="online-badge"
													style={{ marginLeft: "0.5rem" }}
												>
													🔒 {t("locked")}
												</span>
											) : null}
										</td>
										<td style={{ padding: "0.6rem 0.75rem" }}>
											{username ? (
												<Link href={`/u/${username}`}>{username}</Link>
											) : (
												<span className="muted">
													{opener > 0
														? t("userNumber", { id: opener })
														: t("unknown")}
												</span>
											)}
										</td>
										<td style={{ padding: "0.6rem 0.75rem" }}>
											{t2.postsCount ?? 0}
										</td>
										<td className="muted" style={{ padding: "0.6rem 0.75rem" }}>
											{formatDate(
												t2.createdAt ? new Date(t2.createdAt * 1000) : null,
												"date",
											)}
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
