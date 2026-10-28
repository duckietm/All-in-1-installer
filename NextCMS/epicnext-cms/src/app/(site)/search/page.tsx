import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { LocalEventTime } from "@/components/public/local-event-time";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { UserAvatarThumbnail } from "@/components/shared/user-avatar-thumbnail";
import { withPublicPagePerformance } from "@/lib/public-page-performance";
import { loadProfilePrivacyMap } from "@/lib/services/profile-privacy";
import { loadPublicSearch } from "@/lib/services/public-search";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.search");
	return { title: t("title"), description: t("subtitle") };
}
type Params = {
	q?: string;
	usersPage?: string;
	roomsPage?: string;
	newsPage?: string;
	eventsPage?: string;
};
async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
	const t = await getTranslations("pages.search");
	const params = await searchParams;
	const result = await loadPublicSearch({
		query: params.q ?? "",
		usersPage: Number(params.usersPage ?? 1),
		roomsPage: Number(params.roomsPage ?? 1),
		newsPage: Number(params.newsPage ?? 1),
		eventsPage: Number(params.eventsPage ?? 1),
	});
	const query = result?.query ?? "";
	// Users who hide their online state must not have it surfaced here either —
	// the listing, not just the profile, is what makes it enumerable.
	const userRows =
		result?.users.status === "fulfilled" ? result.users.value.rows : [];
	const userPrivacy = await loadProfilePrivacyMap(userRows.map((u) => u.id));
	const pagination = (
		kind: "users" | "rooms" | "news" | "events",
		data: { page: number; lastPage: number; total: number },
	) => {
		const href = (page: number) =>
			`/search?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string")), q: query, [`${kind}Page`]: String(page) })}#${kind}`;
		return (
			<nav
				aria-label={t("pagination", { category: t(kind) })}
				className="mt-4 flex flex-wrap items-center justify-between gap-3"
			>
				{data.page > 1 ? (
					<Link href={href(data.page - 1)} className="btn">
						{t("previous")}
					</Link>
				) : (
					<span />
				)}
				<span className="text-sm">
					{t("pageSummary", {
						page: data.page,
						pages: data.lastPage,
						total: data.total,
					})}
				</span>
				{data.page < data.lastPage ? (
					<Link href={href(data.page + 1)} className="btn">
						{t("next")}
					</Link>
				) : (
					<span />
				)}
			</nav>
		);
	};
	return (
		<section className="page-grid">
			<ContentCard title={t("title")} subtitle={t("subtitle")} icon="🔎" />
			<ContentCard>
				<form
					action="/search"
					method="GET"
					className="flex flex-wrap items-end gap-3"
				>
					<label className="flex min-w-0 flex-1 flex-col gap-1">
						{t("queryLabel")}
						<input
							name="q"
							defaultValue={query}
							maxLength={191}
							className="input w-full"
						/>
					</label>
					<button type="submit" className="btn btn-primary">
						{t("submit")}
					</button>
				</form>
			</ContentCard>
			{!result ? (
				<ContentCard>
					<EmptyState>{t("enterQuery")}</EmptyState>
				</ContentCard>
			) : (
				<>
					<p>{t("resultsFor", { query })}</p>
					<section id="users">
						<ContentCard title={t("users")}>
							{result.users.status === "rejected" ? (
								<p role="alert">{t("loadError")}</p>
							) : (
								<>
									{result.users.value.rows.length === 0 ? (
										<EmptyState>{t("empty")}</EmptyState>
									) : (
										<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
											{result.users.value.rows.map((user) => (
												<Link
													key={user.id}
													href={`/u/${encodeURIComponent(user.username)}`}
													className="flex min-w-0 flex-col items-center gap-2 rounded-xl p-3"
												>
													<UserAvatarThumbnail
														figure={user.look}
														alt={user.username}
														options={{ direction: 2 }}
													/>
													<span className="max-w-full truncate font-bold">
														{user.username}
													</span>
													<span className="text-xs muted">
														{t(
															user.online === "1" &&
																userPrivacy.get(user.id)?.online !== false
																? "online"
																: "offline",
														)}
													</span>
												</Link>
											))}
										</div>
									)}
									{pagination("users", result.users.value)}
								</>
							)}
						</ContentCard>
					</section>
					<section id="rooms">
						<ContentCard title={t("rooms")}>
							{result.rooms.status === "rejected" ? (
								<p role="alert">{t("loadError")}</p>
							) : (
								<>
									{result.rooms.value.rows.length === 0 ? (
										<EmptyState>{t("empty")}</EmptyState>
									) : (
										<div className="card-grid sm-2 lg-3">
											{result.rooms.value.rows.map((room) => (
												<Link
													key={room.id}
													href={`/room/${room.id}`}
													className="card hover p-3"
												>
													<h3 className="break-words font-bold">{room.name}</h3>
													<p className="text-sm muted">
														{room.ownerName} · {room.users}/{room.usersMax}
													</p>
												</Link>
											))}
										</div>
									)}
									{pagination("rooms", result.rooms.value)}
								</>
							)}
						</ContentCard>
					</section>
					<section id="news">
						<ContentCard title={t("news")}>
							{result.news.status === "rejected" ? (
								<p role="alert">{t("loadError")}</p>
							) : (
								<>
									{result.news.value.rows.length === 0 ? (
										<EmptyState>{t("empty")}</EmptyState>
									) : (
										<div className="card-grid sm-2 lg-3">
											{result.news.value.rows.map((article) => (
												<Link
													key={article.slug}
													href={`/news/${article.slug}`}
													className="card hover p-3"
												>
													<h3 className="break-words font-bold">
														{article.title}
													</h3>
												</Link>
											))}
										</div>
									)}
									{pagination("news", result.news.value)}
								</>
							)}
						</ContentCard>
					</section>
					<section id="events">
						<ContentCard title={t("events")}>
							{result.events.status === "rejected" ? (
								<p role="alert">{t("loadError")}</p>
							) : (
								<>
									{result.events.value.rows.length === 0 ? (
										<EmptyState>{t("empty")}</EmptyState>
									) : (
										<div className="card-grid sm-2 lg-3">
											{result.events.value.rows.map((event) => (
												<Link
													key={event.id}
													href={`/events/${event.id}`}
													className="card hover p-3"
												>
													<h3 className="break-words font-bold">
														{event.title}
													</h3>
													<LocalEventTime
														value={event.startsAt.toISOString()}
													/>
												</Link>
											))}
										</div>
									)}
									{pagination("events", result.events.value)}
								</>
							)}
						</ContentCard>
					</section>
				</>
			)}
		</section>
	);
}

export default withPublicPagePerformance("/search", SearchPage);
