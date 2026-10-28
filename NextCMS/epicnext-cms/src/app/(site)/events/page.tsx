import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { LocalEventTime } from "@/components/public/local-event-time";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { auth } from "@/lib/auth";
import { excerpt, slugify } from "@/lib/format";
import { logger } from "@/lib/logger";
import { withPublicPagePerformance } from "@/lib/public-page-performance";
import { loadPublicEvents } from "@/lib/services/public-events";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.events");
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

async function EventsPage({
	searchParams,
}: {
	searchParams: Promise<{
		status?: string;
		week?: string;
		mine?: string;
		page?: string;
	}>;
}) {
	const t = await getTranslations("pages.events");

	const params = await searchParams;
	const session = await auth();
	const currentWeek = new Date();
	currentWeek.setUTCDate(
		currentWeek.getUTCDate() - ((currentWeek.getUTCDay() + 6) % 7),
	);
	const weeklyHref = (offset: number) => {
		const date = new Date(
			result?.week ? `${result.week}T00:00:00Z` : currentWeek,
		);
		date.setUTCDate(date.getUTCDate() + offset * 7);
		return (
			"/events?" +
			new URLSearchParams({
				status: result?.status ?? "all",
				mine: params.mine ?? "",
				week: date.toISOString().slice(0, 10),
			})
		);
	};
	const result = await loadPublicEvents({
		status: params.status,
		week: params.week,
		mine: params.mine === "1",
		userId: Number(session?.user?.id) || undefined,
		page: Number(params.page ?? 1),
	}).catch((error) => {
		logger.error("Public events query failed", { module: "events", error });
		return null;
	});
	const events = result?.events ?? [];
	const href = (page: number) =>
		`/events?${new URLSearchParams({ status: result?.status ?? "all", week: result?.week ?? "", mine: params.mine ?? "", page: String(page) })}`;
	return (
		<section className="page-grid">
			<ContentCard icon="📅" title={t("title")} subtitle={t("subtitle")} />

			<ContentCard>
				<form action="/events" className="flex flex-wrap items-end gap-3">
					<label className="flex flex-col gap-1">
						{t("filterStatus")}
						<select
							name="status"
							defaultValue={result?.status ?? "all"}
							className="input"
						>
							<option value="all">{t("allEvents")}</option>
							<option value="ongoing">{t("statusOngoing")}</option>
							<option value="upcoming">{t("statusUpcoming")}</option>
							<option value="completed">{t("statusCompleted")}</option>
						</select>
					</label>
					<label className="flex flex-col gap-1">
						{t("weekStarting")}
						<input
							name="week"
							type="date"
							defaultValue={result?.week ?? ""}
							className="input"
						/>
					</label>
					{session?.user && (
						<label className="flex items-center gap-2">
							<input
								type="checkbox"
								name="mine"
								value="1"
								defaultChecked={params.mine === "1"}
							/>
							{t("myRegistrations")}
						</label>
					)}
					<button type="submit" className="btn btn-primary">
						{t("apply")}
					</button>
					<Link href="/events" className="btn">
						{t("reset")}
					</Link>
				</form>
				<nav aria-label={t("weeklyView")} className="mt-3 flex flex-wrap gap-3">
					{result?.week ? (
						<>
							<Link className="btn" href={weeklyHref(-1)}>
								{t("previousWeek")}
							</Link>
							<span>{result.week}</span>
							<Link className="btn" href={weeklyHref(1)}>
								{t("nextWeek")}
							</Link>
						</>
					) : (
						<Link className="btn" href={weeklyHref(0)}>
							{t("weeklyView")}
						</Link>
					)}
				</nav>
				<p className="muted mt-3 text-sm">{t("timeZoneHint")}</p>
				{params.mine === "1" && !session?.user && (
					<p>{t("loginForRegistrations")}</p>
				)}
			</ContentCard>
			<ContentCard padded={events.length === 0}>
				{!result ? (
					<p role="alert">{t("loadError")}</p>
				) : events.length === 0 ? (
					<EmptyState icon="📅">{t("empty")}</EmptyState>
				) : (
					<div className="card-grid sm-2 lg-3" style={{ padding: "1rem" }}>
						{events.map((event) => {
							const href = `/events/${slugify(event.title)}-${event.id}`;
							const spots =
								event.maxPlayers != null
									? t("spots", {
											count: event._count.registrations,
											max: event.maxPlayers,
										})
									: t("registered", { count: event._count.registrations });

							return (
								<Link
									key={event.id}
									href={href}
									className="card hover"
									style={{
										display: "flex",
										flexDirection: "column",
										textDecoration: "none",
										padding: 0,
										overflow: "hidden",
										color: "inherit",
									}}
								>
									{event.image ? (
										<div
											style={{
												position: "relative",
												width: "100%",
												aspectRatio: "16/9",
											}}
										>
											<Image
												src={event.image}
												alt=""
												fill
												style={{ objectFit: "cover" }}
												unoptimized
											/>
										</div>
									) : (
										<div
											style={{
												width: "100%",
												aspectRatio: "16/9",
												backgroundColor:
													event.type.color ||
													"color-mix(in srgb, var(--color-primary) 10%, var(--color-navbar))",
											}}
										/>
									)}
									<div
										style={{
											padding: "1rem 1.1rem",
											flex: 1,
											display: "flex",
											flexDirection: "column",
											gap: "0.35rem",
										}}
									>
										<p
											className="muted"
											style={{ margin: 0, fontSize: "0.75rem" }}
										>
											{event.type.name}
											{` · ${t(event.phase === "completed" ? "statusCompleted" : event.phase === "upcoming" ? "statusUpcoming" : "statusOngoing")}`}{" "}
											{event.registered && ` · ${t("youRegistered")}`}
										</p>
										<h3 style={{ margin: 0, fontSize: "1.05rem" }}>
											{event.title}
										</h3>
										<p
											className="muted"
											style={{ margin: 0, fontSize: "0.85rem" }}
										>
											<LocalEventTime value={event.startsAt.toISOString()} />
										</p>
										<p
											style={{
												margin: 0,
												fontSize: "0.88rem",
												lineHeight: 1.5,
											}}
										>
											{excerpt(event.description, 120)}
										</p>
										<p
											className="muted"
											style={{ margin: "auto 0 0", fontSize: "0.8rem" }}
										>
											{spots}
										</p>
									</div>
								</Link>
							);
						})}
					</div>
				)}
			</ContentCard>
			{result && (
				<ContentCard>
					<nav
						aria-label={t("pagination")}
						className="flex flex-wrap items-center justify-between gap-3"
					>
						{result.page > 1 ? (
							<Link href={href(result.page - 1)} className="btn">
								{t("previous")}
							</Link>
						) : (
							<span />
						)}
						<span>
							{t("pageSummary", {
								page: result.page,
								pages: result.lastPage,
								total: result.total,
							})}
						</span>
						{result.page < result.lastPage ? (
							<Link href={href(result.page + 1)} className="btn">
								{t("next")}
							</Link>
						) : (
							<span />
						)}
					</nav>
				</ContentCard>
			)}
		</section>
	);
}

export default withPublicPagePerformance("/events", EventsPage);
