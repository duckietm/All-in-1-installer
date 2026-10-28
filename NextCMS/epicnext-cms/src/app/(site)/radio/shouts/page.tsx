import { desc, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { postShout } from "@/actions/radio-shouts";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { UserAvatarThumbnail } from "@/components/shared/user-avatar-thumbnail";
import { auth } from "@/lib/auth";
import { db, RadioShouts, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

type SearchParams = Promise<{ posted?: string; error?: string }>;

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

export default async function RadioShoutsPage({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	const t = await getTranslations("pages.radioShouts");
	const { posted, error } = await searchParams;

	const [shouts, session] = await Promise.all([
		db
			.select()
			.from(RadioShouts)
			.orderBy(desc(RadioShouts.createdAt))
			.limit(50)
			.catch(() => []),
		auth(),
	]);

	const isLoggedIn = Boolean(session?.user?.id);

	// Resolve author usernames/looks. shout.userId is BigInt; User.id is Int.
	const authorIds = Array.from(new Set(shouts.map((s) => Number(s.userId))));
	const authors = authorIds.length
		? await db
				.select({
					id: User.id,
					username: User.username,
					look: User.look,
				})
				.from(User)
				.where(inArray(User.id, authorIds))
				.catch(() => [])
		: [];
	const authorById = new Map(authors.map((a) => [a.id, a]));

	const errorMessage =
		error === "invalid"
			? t("errors.invalid")
			: error === "moderated"
				? t("errors.moderated")
				: error === "ratelimit"
					? t("errors.ratelimit")
					: error
						? t("errors.error")
						: null;

	return (
		<section className="page-grid">
			{posted === "1" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.posted")}
				</div>
			) : null}
			{errorMessage ? (
				<div role="alert" style={feedbackStyle("error")}>
					{errorMessage}
				</div>
			) : null}

			<ContentCard icon="📣" title={t("title")} subtitle={t("subtitle")} />

			{isLoggedIn ? (
				<ContentCard
					icon="✍️"
					title={t("postTitle")}
					subtitle={t("postSubtitle")}
				>
					{/* The author is taken from the session inside the action, never from
              this form — no user id is submitted. */}
					<form action={postShout}>
						<label htmlFor="shout-message" className="muted">
							{t("messageLabel")}
						</label>
						<textarea
							id="shout-message"
							name="message"
							required
							maxLength={255}
							rows={3}
							placeholder={t("messagePlaceholder")}
							style={{
								width: "100%",
								margin: "0.4rem 0 0.75rem",
								resize: "vertical",
							}}
						/>
						<button type="submit" className="btn btn-primary">
							{t("shoutButton")}
						</button>
					</form>
				</ContentCard>
			) : (
				<ContentCard padded>
					<EmptyState icon="🔒">{t("loginToPost")}</EmptyState>
				</ContentCard>
			)}

			<ContentCard
				icon="💬"
				title={t("latestTitle")}
				subtitle={t("latestSubtitle")}
				padded={shouts.length === 0}
			>
				{shouts.length === 0 ? (
					<EmptyState icon="📣">{t("empty")}</EmptyState>
				) : (
					<div className="card-grid">
						{shouts.map((s) => {
							const author = authorById.get(Number(s.userId));
							return (
								<div
									key={String(s.id)}
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
									<div style={{ flex: 1, minWidth: 0 }}>
										<p style={{ margin: "0 0 0.25rem" }}>
											<strong>{author?.username ?? `User #${s.userId}`}</strong>{" "}
											<span className="muted">
												{formatDate(s.createdAt, "datetime", "")}
											</span>
										</p>
										<p style={{ margin: 0 }}>{s.message}</p>
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
