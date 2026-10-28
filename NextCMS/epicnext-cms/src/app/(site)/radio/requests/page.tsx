import { desc, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { submitRequest } from "@/actions/radio-requests";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { auth } from "@/lib/auth";
import { db, RadioSongRequests, User } from "@/lib/db";
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

export default async function RadioRequestsPage({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	const t = await getTranslations("pages.radioRequests");
	const genericT = await getTranslations("pages.radio");
	const { posted, error } = await searchParams;

	const errorMessage =
		error === "empty"
			? t("errors.empty")
			: error === "ratelimit"
				? t("errors.ratelimit")
				: error === "invalid"
					? t("errors.invalid")
					: error
						? t("errors.error")
						: null;

	const [requests, session] = await Promise.all([
		db
			.select()
			.from(RadioSongRequests)
			.orderBy(desc(RadioSongRequests.createdAt))
			.limit(50)
			.catch(() => []),
		auth(),
	]);

	const isLoggedIn = Boolean(session?.user?.id);

	const userIds = Array.from(new Set(requests.map((r) => Number(r.userId))));
	const users = userIds.length
		? await db
				.select({ id: User.id, username: User.username })
				.from(User)
				.where(inArray(User.id, userIds))
				.catch(() => [])
		: [];
	const userById = new Map(users.map((u) => [u.id, u.username]));

	return (
		<>
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

			<ContentCard
				icon="🎵"
				title={genericT("linkRequests")}
				subtitle={genericT("linkRequestsText")}
			/>

			{isLoggedIn ? (
				<ContentCard
					icon="✍️"
					title={t("formTitle")}
					subtitle={t("formSubtitle")}
				>
					<form action={submitRequest}>
						<div className="card-grid sm-2">
							<div>
								<label htmlFor="songTitle" className="muted">
									{t("songLabel")}
								</label>
								<input
									id="songTitle"
									name="songTitle"
									type="text"
									required
									maxLength={255}
									placeholder={t("songPlaceholder")}
									style={{ width: "100%", marginTop: "0.3rem" }}
								/>
							</div>
							<div>
								<label htmlFor="artist" className="muted">
									{t("artistLabel")}
								</label>
								<input
									id="artist"
									name="artist"
									type="text"
									maxLength={255}
									placeholder={t("artistPlaceholder")}
									style={{ width: "100%", marginTop: "0.3rem" }}
								/>
							</div>
						</div>
						<button
							type="submit"
							className="btn btn-primary"
							style={{ marginTop: "1rem" }}
						>
							{t("submitButton")}
						</button>
					</form>
				</ContentCard>
			) : (
				<ContentCard padded>
					<EmptyState icon="🔒">{t("loginToRequest")}</EmptyState>
				</ContentCard>
			)}

			<ContentCard
				icon="📋"
				title={t("latestTitle")}
				subtitle={t("latestSubtitle")}
				padded={requests.length === 0}
			>
				{requests.length === 0 ? (
					<EmptyState icon="🎵">{t("empty")}</EmptyState>
				) : (
					<table>
						<thead>
							<tr>
								<th>{t("colSong")}</th>
								<th>{t("colArtist")}</th>
								<th>{t("colRequester")}</th>
								<th>{t("colDate")}</th>
								<th>{t("colStatus")}</th>
							</tr>
						</thead>
						<tbody>
							{requests.map((r) => {
								const requester = userById.get(Number(r.userId));
								const isPlayed = r.isPlayed;
								const isApproved = r.isApproved;
								let status = t("statusPending");
								if (isPlayed) status = t("statusPlayed");
								else if (isApproved) status = t("statusApproved");

								return (
									<tr key={String(r.id)}>
										<td>{r.songTitle || <span className="muted">—</span>}</td>
										<td>{r.artist || <span className="muted">—</span>}</td>
										<td>
											{requester ? (
												<span>{requester}</span>
											) : (
												<span className="muted">#{String(r.userId)}</span>
											)}
										</td>
										<td className="muted">
											{r.submittedAt
												? formatDate(r.submittedAt, "datetime", "")
												: "—"}
										</td>
										<td>{status}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</ContentCard>
		</>
	);
}
