import { desc, eq } from "drizzle-orm";
import { ArrowRight, ChevronDown } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CSSProperties, ReactNode } from "react";
import { AnimatedCounter } from "@/components/animated-counter";
import { AuthTopBar } from "@/components/auth/auth-top-bar";
import { LoginForm } from "@/components/auth/login-form";
import Link from "@/components/link";
import { Reveal } from "@/components/motion-reveal";
import { JsonLd } from "@/components/public/json-ld";
import { PublicLoadError } from "@/components/public/load-error";
import { UserAvatarThumbnail } from "@/components/shared/user-avatar-thumbnail";
import { SpotlightCard } from "@/components/spotlight-card";
import { TypewriterText } from "@/components/typewriter-text";
import { auth } from "@/lib/auth";
import { cached } from "@/lib/cache";
import { CameraWeb, db, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { resolveHotelName } from "@/lib/hotel-name";
import { withPublicPagePerformance } from "@/lib/public-page-performance";
import {
	absoluteAssetUrl,
	appBaseUrl,
	buildWebsiteStructuredData,
} from "@/lib/seo";
import { captchaConfig } from "@/lib/services/captcha";
import { getNewsList } from "@/lib/services/news-list";
import { loadProfilePrivacyMap } from "@/lib/services/profile-privacy";
import {
	cachedOnlineCount,
	countArticles,
	countPhotos,
	countRooms,
	countUsers,
} from "@/lib/services/public-counters";
import { publicReadFailure } from "@/lib/services/public-read";
import { siteSettings } from "@/lib/services/site-settings";
import {
	ICON_ARTICLE,
	ICON_CAMERA,
	ICON_CATALOG,
	ICON_FRIENDS,
	ICON_NAV_GOODY,
	ICON_NAV_ME,
	ICON_STAR,
} from "@/lib/site-icons";

export async function generateMetadata(): Promise<Metadata> {
	const tn = await getTranslations("nav");
	const tp = await getTranslations("pages.home");
	const title = tn("home");
	const description = tp("welcomeBody");
	const appUrl = appBaseUrl();
	return {
		title,
		description,
		alternates: {
			canonical: appUrl,
			types: { "application/rss+xml": `${appUrl}/news/rss.xml` },
		},
		openGraph: { title, description, type: "website", url: appUrl },
	};
}

/* ── Local visual language ────────────────────────────────────────────
   The landing panels used to carry their own translucent washes
   (surface 44–60 % + a backdrop blur each). Four different milky smears over
   the sky gradient, and a backdrop snapshot per panel on every scroll. The
   shared `.panel*` classes in globals.css now own the surface recipe, so the
   boxes read as one system and cost nothing to paint. */

// The hero scrim. A photo always needs a dark wash for the copy to stay
// readable, so this one stays a fixed dark gradient in both themes.
const HERO_SCRIM =
	"linear-gradient(180deg, rgba(8,11,24,0.80) 0%, rgba(8,11,24,0.58) 38%, rgba(8,11,24,0.42) 62%, rgba(8,11,24,0.60) 85%, color-mix(in srgb, var(--color-background) 92%, transparent) 100%)";

const HERO_COPY = "rgba(255,255,255,0.80)";
const HERO_COPY_STRONG = "rgba(255,255,255,0.96)";

const DARK_BAND =
	"linear-gradient(120deg, color-mix(in srgb, var(--color-primary) 30%, #0a0e1e) 0%, color-mix(in srgb, var(--color-accent) 26%, #0a0e1e) 52%, color-mix(in srgb, var(--color-primary) 20%, #0a0e1e) 100%)";

/** Accent used for the nth surface of a repeating set. */
function tintFor(index: number): string {
	return index % 2 === 0 ? "var(--color-primary)" : "var(--color-accent)";
}

interface PanelHeaderProps {
	title: string;
	icon?: string;
	actionHref?: string;
	actionLabel?: string;
}

/**
 * The header row every landing panel shares: tinted icon chip, title and an
 * optional "see everything" link.
 */
function PanelHeader({
	title,
	icon,
	actionHref,
	actionLabel,
}: PanelHeaderProps) {
	return (
		<div className="panel-header flex items-center justify-between gap-3 px-5 py-3.5">
			<div className="flex min-w-0 items-center gap-2.5">
				{icon && (
					<div
						className="panel-tile flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
						style={{ "--panel-tint": "var(--color-primary)" } as CSSProperties}
					>
						<Image
							src={icon}
							alt=""
							width={18}
							height={18}
							unoptimized
							className="opacity-90"
						/>
					</div>
				)}
				<h2
					className="truncate text-sm font-extrabold tracking-wide"
					style={{
						fontFamily: "var(--font-nunito)",
						color: "var(--color-text-readable)",
					}}
				>
					{title}
				</h2>
			</div>
			{actionHref && actionLabel && (
				<Link
					href={actionHref}
					className="shrink-0 text-xs font-bold transition-all duration-300 hover:translate-x-0.5"
					style={{
						color: "var(--color-primary-readable, var(--color-primary))",
					}}
				>
					{actionLabel}
				</Link>
			)}
		</div>
	);
}

interface PanelProps {
	children: ReactNode;
	title?: string;
	icon?: string;
	actionHref?: string;
	actionLabel?: string;
	bodyClassName?: string;
	className?: string;
}

/** A themed surface with an optional header. */
function Panel({
	children,
	title,
	icon,
	actionHref,
	actionLabel,
	bodyClassName,
	className,
}: PanelProps) {
	const hasHeader = Boolean(title || icon);

	return (
		<div
			className={`panel card-glow card-hairline relative overflow-hidden rounded-[var(--panel-radius)] ${
				className ?? ""
			}`}
		>
			{hasHeader && (
				<PanelHeader
					title={title ?? ""}
					icon={icon}
					actionHref={actionHref}
					actionLabel={actionLabel}
				/>
			)}
			{hasHeader ? (
				<div className={bodyClassName ?? "p-5"}>{children}</div>
			) : (
				children
			)}
		</div>
	);
}

/**
 * Cover image for a news article. Articles without an upload used to render a
 * broken <Image>, so they fall back to a themed plate instead.
 */
function ArticleCover({
	src,
	alt,
	featured,
}: {
	src: string;
	alt: string;
	featured: boolean;
}) {
	if (!src) {
		return (
			<div
				className="flex h-full w-full items-center justify-center"
				style={{
					background:
						"linear-gradient(140deg, color-mix(in srgb, var(--color-primary) 26%, var(--color-surface)), color-mix(in srgb, var(--color-accent) 18%, var(--color-surface)))",
				}}
			>
				<Image
					src={ICON_ARTICLE}
					alt=""
					width={featured ? 56 : 40}
					height={featured ? 56 : 40}
					unoptimized
					className="opacity-70"
				/>
			</div>
		);
	}

	return (
		<Image
			src={src}
			alt={alt}
			fill
			sizes={
				featured
					? "(max-width: 768px) 100vw, 60vw"
					: "(max-width: 640px) 100vw, 20vw"
			}
			className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
			unoptimized
		/>
	);
}

async function getHotelData() {
	const [
		hotelName,
		logo,
		online,
		users,
		rooms,
		totalPhotos,
		articleCount,
		articles,
		recentUsers,
		recentPhotos,
	] = await Promise.all([
		resolveHotelName(),
		siteSettings.get("cms_logo", ""),
		cachedOnlineCount().catch(publicReadFailure("home.online")),
		cached("total_users", 300_000, countUsers, { staleMs: 300000 }).catch(
			publicReadFailure("home.users"),
		),
		cached("total_rooms", 300_000, countRooms, { staleMs: 300000 }).catch(
			publicReadFailure("home.rooms"),
		),
		cached("total_photos", 300_000, countPhotos, { staleMs: 300000 }).catch(
			publicReadFailure("home.photos-count"),
		),
		cached("total_articles", 300_000, countArticles, {
			staleMs: 300000,
		}).catch(publicReadFailure("home.articles-count")),
		getNewsList(4, { throwOnError: true }).catch(
			publicReadFailure("home.news"),
		),
		cached(
			"home_online_users",
			15_000,
			() =>
				db
					.select({ id: User.id, username: User.username, look: User.look })
					.from(User)
					.where(eq(User.online, "1"))
					.limit(12),
			{ staleMs: 30000 },
		).catch(publicReadFailure("home.recent-users")),
		cached(
			"home_recent_photos",
			60_000,
			() =>
				db
					.select({ id: CameraWeb.id, url: CameraWeb.url })
					.from(CameraWeb)
					.orderBy(desc(CameraWeb.timestamp))
					.limit(4),
			{ staleMs: 120000 },
		).catch(publicReadFailure("home.photos")),
	]);

	return {
		hotelName,
		online,
		users,
		rooms,
		totalPhotos,
		articleCount,
		articles,
		recentUsers,
		recentPhotos,
		logo,
	};
}

async function Home() {
	const session = await auth();
	if (session?.user?.id) redirect("/me");

	const [
		tp,
		te,
		th,
		tn,
		{
			hotelName,
			online,
			users,
			rooms,
			totalPhotos,
			articleCount,
			articles,
			recentUsers: rawRecentUsers,
			recentPhotos,
			logo,
		},
		captcha,
		nonceHeaders,
	] = await Promise.all([
		getTranslations("pages.home"),
		getTranslations("publicData"),
		getTranslations("header"),
		getTranslations("nav"),
		getHotelData(),
		captchaConfig(),
		headers(),
	]);

	// Users who hide their online state must not surface in the "who is online"
	// rails on the homepage either.
	const recentUserPrivacy = await loadProfilePrivacyMap(
		(rawRecentUsers ?? []).map((u) => u.id),
	);
	const recentUsers =
		rawRecentUsers === null
			? null
			: rawRecentUsers.filter(
					(u) => recentUserPrivacy.get(u.id)?.online !== false,
				);
	const nonce = nonceHeaders.get("x-nonce") ?? undefined;

	const features = [
		{
			title: tp("featuresAvatar"),
			desc: tp("featuresAvatarDesc"),
			icon: ICON_FRIENDS,
		},
		{
			title: tp("featuresFurniture"),
			desc: tp("featuresFurnitureDesc"),
			icon: ICON_CATALOG,
		},
		{
			title: tp("featuresCommunity"),
			desc: tp("featuresCommunityDesc"),
			icon: ICON_NAV_GOODY,
		},
		{
			title: tp("featuresGames"),
			desc: tp("featuresGamesDesc"),
			icon: ICON_STAR,
		},
	];

	type NewsArticle = NonNullable<typeof articles>[number];

	const renderArticleCard = (a: NewsArticle, featured = false) => {
		const published = a.createdAt ? formatDate(a.createdAt, "date", "") : "";

		return (
			<Link
				key={a.slug}
				href={`/news/${a.slug}`}
				className="group relative block w-full overflow-hidden rounded-[var(--panel-radius)] border transition-all duration-500 hover:-translate-y-1 hover:shadow-2xl"
				style={{
					height: featured
						? "clamp(240px, 28vw, 320px)"
						: "clamp(180px, 20vw, 230px)",
					backgroundColor: "var(--color-text-muted)",
					borderColor: "var(--panel-border)",
				}}
			>
				<div className="relative h-full w-full overflow-hidden rounded-[var(--panel-radius)]">
					<ArticleCover src={a.image} alt={a.title} featured={featured} />
					<div
						className="absolute right-2.5 top-2.5 flex h-8 w-8 translate-x-1 items-center justify-center rounded-full opacity-0 backdrop-blur-sm transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100"
						style={{ background: "color-mix(in srgb, #000 45%, transparent)" }}
					>
						<span
							className="text-sm font-bold"
							style={{ color: HERO_COPY_STRONG }}
						>
							<ArrowRight className="h-4 w-4" aria-hidden="true" />
						</span>
					</div>
					{published && (
						<div
							className="absolute left-2.5 top-2.5 rounded-full px-2 py-0.5 text-[10px] font-bold backdrop-blur-sm"
							style={{
								background: "color-mix(in srgb, #000 45%, transparent)",
								color: "#fff",
							}}
						>
							{published}
						</div>
					)}
					<div
						className="absolute bottom-0 left-0 w-full p-3 sm:p-4"
						style={{
							background:
								"linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)",
						}}
					>
						{featured && (
							<p className="mb-1 text-[10px] font-bold uppercase tracking-widest opacity-90">
								{tp("latestArticle")}
							</p>
						)}
						<h3
							className={`line-clamp-2 font-bold text-shadow-sm ${
								featured ? "text-base sm:text-2xl" : "text-sm sm:text-base"
							}`}
							style={{ color: HERO_COPY_STRONG }}
						>
							{a.title}
						</h3>
					</div>
				</div>
			</Link>
		);
	};

	const exploreLinks = [
		{ href: "/community", label: tn("community") },
		{ href: "/news", label: tn("articles") },
		{ href: "/events", label: tn("events") },
		{ href: "/photos", label: tn("photos") },
		{ href: "/radio", label: tn("radio") },
		{ href: "/shop", label: tn("shop") },
		{ href: "/rankings", label: tn("rankings") },
	];

	// One source of truth for the four headline counters. They used to be
	// rendered twice — as four small chips in the hero and again as a full
	// panel further down — which made the page feel padded and repeated.
	// A failed read stays visible as "unavailable" instead of silently
	// shrinking the row, so a broken counter can never be mistaken for zero.
	const statItems = [
		{ value: users, label: tp("statsCitizens"), icon: ICON_FRIENDS },
		{ value: rooms, label: tp("statsRooms"), icon: ICON_CATALOG },
		{ value: totalPhotos, label: tp("statsPhotos"), icon: ICON_CAMERA },
		{ value: articleCount, label: tp("statsArticles"), icon: ICON_ARTICLE },
	];

	const structuredData = buildWebsiteStructuredData({
		hotelName,
		url: appBaseUrl(),
		logo: absoluteAssetUrl(logo, appBaseUrl()),
	});

	return (
		<div className="flex w-full flex-col gap-14 pb-16 pt-2 md:gap-20 md:pb-24">
			<JsonLd data={structuredData} />
			{/* ── Top bar: logo + live online + language/clock/theme ── */}
			<div className="mx-auto w-full max-w-7xl">
				<AuthTopBar hotelName={hotelName} logo={logo} online={online} />
			</div>

			{/* ── Hero + the headline counters, which straddle the hero edge ──
			    Not in <Reveal>: that hides its content until the page's JavaScript runs, and the hero image is
			    the largest thing on the page (its load time is what visitors feel as "the page is there"). */}
			<div className="relative w-full">
				<div className="-mx-3 sm:-mx-4 md:-mx-6">
					<div className="relative overflow-hidden">
						<Image
							src="/assets/images/next_header.jpg"
							alt=""
							fill
							priority
							sizes="100vw"
							className="ken-burns"
							style={{ objectFit: "cover", objectPosition: "center 20%" }}
						/>
						<div
							className="absolute inset-0"
							style={{ background: HERO_SCRIM }}
						/>
						{/* Drifting brand-tinted aurora behind the copy */}
						<div
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 overflow-hidden"
						>
							<div
								className="aurora-blob -left-24 top-1/4 h-[420px] w-[420px]"
								style={{
									background:
										"color-mix(in srgb, var(--color-primary) 35%, transparent)",
									opacity: 0.5,
								}}
							/>
							<div
								className="aurora-blob -right-24 top-1/3 h-[380px] w-[380px]"
								style={{
									background:
										"color-mix(in srgb, var(--color-accent) 32%, transparent)",
									animationDelay: "-7s",
									opacity: 0.45,
								}}
							/>
						</div>
						<div
							aria-hidden="true"
							className="brand-halo left-1/2 top-1/2 h-[420px] w-[720px] max-w-full -translate-x-1/2 -translate-y-1/2"
							style={{ opacity: 0.5, zIndex: 1 }}
						/>
						<div className="relative z-10 mx-auto flex min-h-[540px] w-full max-w-6xl flex-col items-center justify-center px-4 py-24 text-center sm:min-h-[580px] lg:min-h-[640px]">
							<h1 style={{ fontFamily: "var(--font-nunito)" }}>
								<span
									className="mb-3 block text-xs font-extrabold uppercase tracking-[0.32em] sm:text-sm"
									style={{ color: "rgba(255,255,255,0.72)" }}
								>
									{tp("heroEyebrow")}
								</span>
								<span className="gradient-text drop-shadow-[0_2px_24px_rgba(0,0,0,0.55)] block text-5xl font-black leading-[1.02] tracking-tight sm:text-6xl md:text-7xl lg:text-8xl">
									<TypewriterText text={hotelName} />
								</span>
							</h1>

							<p
								className="mt-6 max-w-xl text-sm font-semibold leading-relaxed sm:text-base md:text-lg"
								style={{ color: HERO_COPY }}
							>
								{tp("welcomeBody")}
							</p>

							<div
								className="animate-fade-in-up mt-9 flex flex-wrap items-center justify-center gap-3"
								style={{ animationDelay: "0.2s" }}
							>
								<Link
									href="/register"
									className="btn-brand btn-shine px-8 py-4 text-sm font-black uppercase tracking-wider"
								>
									<Image
										src="/assets/images/EnterHubbly.png"
										alt=""
										width={20}
										height={20}
										unoptimized
									/>
									{tp("register")}
								</Link>
								<Link
									href="/login"
									className="btn-glass-dark group px-8 py-4 text-sm font-bold"
								>
									{th("login")}
									<span
										aria-hidden="true"
										className="inline-flex transition-transform duration-300 group-hover:translate-x-1"
									>
										<ArrowRight className="h-4 w-4" />
									</span>
								</Link>
							</div>
						</div>

						{/* Scroll cue */}
						<div
							aria-hidden="true"
							className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 sm:block"
							style={{ zIndex: 2 }}
						>
							<div
								className="hero-cue flex h-10 w-10 items-center justify-center rounded-full"
								style={{
									background: "rgba(255,255,255,0.09)",
									border: "1px solid rgba(255,255,255,0.3)",
									backdropFilter: "blur(10px)",
									WebkitBackdropFilter: "blur(10px)",
								}}
							>
								<ChevronDown
									className="h-5 w-5"
									style={{ color: "rgba(255,255,255,0.88)" }}
								/>
							</div>
						</div>

						{/* Floating mascot — decorative, hidden on smaller screens. */}
						<div
							aria-hidden="true"
							className="pointer-events-none absolute bottom-8 right-8 hidden lg:block xl:right-14"
							style={{ zIndex: 2 }}
						>
							<div className="brand-halo left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 xl:h-52 xl:w-52" />
							<Image
								src="/assets/images/FrankwithBag.gif"
								alt=""
								width={96}
								height={128}
								unoptimized
								className="relative animate-float object-contain drop-shadow-2xl"
							/>
						</div>

						<div className="hero-ring" aria-hidden="true" />
					</div>
				</div>

				{/* The headline counters. They straddle the hero edge so the
				    numbers land above the fold instead of in a second block
				    further down the page. */}
				<div className="relative z-20 mx-auto -mt-14 w-full max-w-4xl px-3 sm:-mt-16 sm:px-4 md:px-6">
					<div className="panel panel-float relative overflow-hidden rounded-[var(--panel-radius)] px-2 py-5 sm:px-4 sm:py-6">
						<div className="grid grid-cols-2 gap-y-6 lg:grid-cols-4 lg:gap-y-0">
							{statItems.map((s, i) => (
								<div
									key={s.label}
									className="stat-cell group flex flex-col items-center gap-2 text-center"
								>
									<div
										className="panel-tile flex h-10 w-10 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110"
										style={
											{
												"--panel-tint": tintFor(i),
											} as CSSProperties
										}
									>
										<Image
											src={s.icon}
											alt=""
											width={20}
											height={20}
											unoptimized
										/>
									</div>
									<div
										className="gradient-text text-3xl font-black tracking-tight sm:text-4xl"
										style={{ fontVariantNumeric: "tabular-nums" }}
									>
										{s.value === null ? (
											<span
												className="text-base font-bold"
												style={{
													color:
														"var(--color-text-muted-readable, var(--color-text-muted))",
												}}
											>
												{te("unavailable")}
											</span>
										) : (
											<AnimatedCounter value={s.value} />
										)}
									</div>
									<span
										className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest"
										style={{
											background:
												"color-mix(in srgb, var(--color-text-muted) 9%, transparent)",
											color: "var(--color-text-readable)",
										}}
									>
										{s.label}
									</span>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>

			{/* ── Quick explore ── */}
			<Reveal className="-mt-6 mx-auto w-full max-w-7xl">
				<nav
					aria-label={tp("exploreLabel")}
					className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3"
				>
					{exploreLinks.map((l, i) => (
						<Link key={l.href} href={l.href} className="explore-pill group">
							<span
								aria-hidden="true"
								className="h-1.5 w-1.5 shrink-0 rounded-full"
								style={{
									background: tintFor(i),
									boxShadow: `0 0 8px color-mix(in srgb, ${tintFor(i)} 70%, transparent)`,
								}}
							/>
							{l.label}
							<ArrowRight
								aria-hidden="true"
								className="pill-arrow h-3.5 w-3.5"
								style={{
									color: "var(--color-primary-readable, var(--color-primary))",
								}}
							/>
						</Link>
					))}
				</nav>
			</Reveal>

			{/* ── Features ── */}
			<Reveal className="mx-auto w-full max-w-7xl">
				<div className="flex flex-col gap-6 sm:gap-8">
					<div>
						<span className="eyebrow">{tp("sectionFeaturesLabel")}</span>
						<h2
							className="section-title mt-2 text-2xl sm:text-3xl md:text-4xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{tp("sectionFeaturesTitle")}
						</h2>
					</div>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
						{features.map((f, i) => (
							<SpotlightCard
								key={f.title}
								className="panel card-glow card-hairline group relative overflow-hidden rounded-[var(--panel-radius)] p-6 transition-all duration-500 hover:-translate-y-1.5 hover:shadow-2xl sm:p-7"
							>
								<span
									aria-hidden="true"
									className="pointer-events-none absolute right-5 top-4 select-none text-5xl font-black leading-none opacity-[0.07] transition-opacity duration-500 group-hover:opacity-20"
									style={{
										background:
											"linear-gradient(120deg, var(--color-primary), var(--color-accent))",
										WebkitBackgroundClip: "text",
										backgroundClip: "text",
										color: "transparent",
									}}
								>
									{`0${i + 1}`}
								</span>
								<div
									className="panel-tile relative flex h-12 w-12 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3"
									style={
										{
											"--panel-tint": tintFor(i),
											borderRadius: 14,
										} as CSSProperties
									}
								>
									<Image
										src={f.icon}
										alt=""
										width={24}
										height={24}
										unoptimized
									/>
								</div>
								<h3
									className="relative mt-5 text-base font-extrabold sm:text-lg"
									style={{
										color: "var(--color-text-readable)",
										fontFamily: "var(--font-nunito)",
									}}
								>
									{f.title}
								</h3>
								<p
									className="relative mt-1.5 text-sm leading-relaxed"
									style={{
										color:
											"var(--color-text-muted-readable, var(--color-text-muted))",
									}}
								>
									{f.desc}
								</p>
							</SpotlightCard>
						))}
					</div>
				</div>
			</Reveal>

			{/* ── Community ── */}
			<Reveal className="mx-auto w-full max-w-7xl">
				<div className="flex flex-col gap-6 sm:gap-8">
					<div>
						<span className="eyebrow">{tp("sectionCommunityLabel")}</span>
						<h2
							className="section-title mt-2 text-2xl sm:text-3xl md:text-4xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{tp("sectionCommunityTitle")}
						</h2>
					</div>
					<div className="flex flex-col gap-4 md:flex-row">
						<div className="flex w-full flex-col gap-4 md:w-1/3 md:flex-shrink-0">
							<Panel
								title={th("login")}
								icon={ICON_NAV_ME}
								bodyClassName="p-3.5 sm:p-4"
							>
								<LoginForm
									variant="compact"
									redirectTo="/"
									captcha={{
										provider: captcha.provider,
										siteKey: captcha.siteKey || undefined,
										field: captcha.field || undefined,
									}}
									nonce={nonce}
								/>
							</Panel>

							{recentUsers === null ? (
								<Panel title={tp("recentUsers")} bodyClassName="p-4">
									<PublicLoadError href="/" />
								</Panel>
							) : (
								recentUsers.length > 0 && (
									<Panel
										title={tp("recentUsers")}
										icon={ICON_NAV_GOODY}
										actionHref="/community"
										actionLabel={tp("allUsers")}
										bodyClassName="p-3.5 sm:p-4"
									>
										<div className="grid grid-cols-4 gap-1.5 sm:gap-2">
											{recentUsers.map((u) => (
												<Link
													key={u.username}
													href={`/u/${encodeURIComponent(u.username)}`}
													title={u.username}
													className="group flex flex-col items-center gap-1 rounded-xl border border-transparent p-1.5 transition-all duration-200 hover:border-[color-mix(in_srgb,var(--color-primary)_32%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-primary)_8%,transparent)]"
												>
													<span className="relative">
														<UserAvatarThumbnail
															figure={u.look}
															alt={u.username}
															options={{ direction: 2 }}
															className="rounded-md"
														/>
														<span
															aria-hidden="true"
															className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full"
															style={{
																background: "var(--color-accent)",
																boxShadow: "0 0 0 2px var(--panel-surface)",
															}}
														/>
													</span>
													<span
														className="max-w-[64px] truncate text-center text-[9px] sm:text-[10px] font-bold leading-tight"
														style={{ color: "var(--color-text-readable)" }}
													>
														{u.username}
													</span>
												</Link>
											))}
										</div>
									</Panel>
								)
							)}
						</div>

						{/* News */}
						<div className="flex w-full flex-col md:w-2/3">
							<Panel
								title={tp("latestNews")}
								icon={ICON_ARTICLE}
								actionHref="/news"
								actionLabel={tp("allNews")}
							>
								{articles === null ? (
									<PublicLoadError href="/" />
								) : articles.length > 0 ? (
									<div className="flex flex-col gap-3 sm:gap-4">
										{renderArticleCard(articles[0], true)}
										<div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
											{articles.slice(1, 4).map((a) => renderArticleCard(a))}
										</div>
									</div>
								) : (
									<p
										className="py-8 text-center text-sm"
										style={{
											color:
												"var(--color-text-muted-readable, var(--color-text-muted))",
										}}
									>
										{tp("noArticles")}
									</p>
								)}
							</Panel>
						</div>
					</div>
				</div>
			</Reveal>

			{/* ── Recent photos ── */}
			{recentPhotos === null ? (
				<Reveal className="mx-auto w-full max-w-7xl">
					<Panel title={tp("recentPhotos")} bodyClassName="p-4">
						<PublicLoadError href="/" />
					</Panel>
				</Reveal>
			) : (
				recentPhotos.length > 0 && (
					<Reveal className="mx-auto w-full max-w-7xl">
						<Panel title={tp("recentPhotos")} icon={ICON_CAMERA}>
							<div className="mx-auto grid max-w-5xl grid-cols-2 gap-3 sm:grid-cols-4">
								{recentPhotos.slice(0, 4).map((p, i) => (
									<Link
										key={p.id}
										href="/photos"
										className="block aspect-[4/3] overflow-hidden rounded-2xl border transition-all duration-300 ease-out hover:scale-[1.03] hover:shadow-xl hover:ring-2 hover:ring-[color-mix(in_srgb,var(--color-primary)_45%,transparent)]"
										style={{ borderColor: "var(--panel-border)" }}
									>
										{p.url ? (
											<Image
												src={p.url}
												alt={`${tp("recentPhotos")} ${i + 1}`}
												width={280}
												height={210}
												className="h-full w-full object-cover"
												unoptimized
											/>
										) : (
											<span
												className="flex h-full w-full items-center justify-center"
												style={{
													background:
														"linear-gradient(140deg, color-mix(in srgb, var(--color-primary) 22%, var(--color-surface)), color-mix(in srgb, var(--color-accent) 16%, var(--color-surface)))",
												}}
											>
												<Image
													src={ICON_CAMERA}
													alt=""
													width={32}
													height={32}
													unoptimized
													className="opacity-70"
												/>
											</span>
										)}
									</Link>
								))}
							</div>
						</Panel>
					</Reveal>
				)
			)}

			{/* ── Join the fun ── */}
			<Reveal className="mx-auto w-full max-w-7xl">
				<section
					aria-labelledby="join-cta-title"
					className="relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:px-10 sm:py-16"
					style={{
						background: DARK_BAND,
						border:
							"1px solid color-mix(in srgb, var(--color-primary) 28%, transparent)",
						boxShadow:
							"0 40px 90px -40px color-mix(in srgb, #000 50%, transparent), 0 0 0 0.5px color-mix(in srgb, #000 20%, transparent)",
					}}
				>
					<div
						aria-hidden="true"
						className="brand-halo left-1/2 top-0 h-72 w-[620px] max-w-full -translate-x-1/2 -translate-y-1/3"
						style={{ opacity: 0.6 }}
					/>
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 overflow-hidden"
					>
						<div
							className="aurora-blob -left-20 bottom-0 h-72 w-72"
							style={{
								background:
									"color-mix(in srgb, var(--color-accent) 45%, transparent)",
								opacity: 0.5,
							}}
						/>
						<div
							className="aurora-blob -right-16 top-4 h-64 w-64"
							style={{
								background:
									"color-mix(in srgb, var(--color-primary) 45%, transparent)",
								animationDelay: "-6s",
								opacity: 0.5,
							}}
						/>
					</div>
					<h2
						id="join-cta-title"
						className="relative text-3xl font-black tracking-tight text-balance sm:text-4xl"
						style={{ color: "#fff" }}
					>
						{tp("joinCtaTitle")}
					</h2>
					<p
						className="relative mx-auto mt-3 max-w-xl text-sm leading-relaxed sm:text-base"
						style={{ color: "rgba(255,255,255,0.72)" }}
					>
						{tp("joinCtaBody")}
					</p>
					<div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
						<Link
							href="/register"
							className="btn-brand btn-shine group px-8 py-4 text-sm font-black uppercase tracking-wide"
						>
							{tp("ctaJoin")}
							<span
								aria-hidden="true"
								className="inline-flex transition-transform duration-300 group-hover:translate-x-1"
							>
								<ArrowRight className="h-4 w-4" />
							</span>
						</Link>
						<Link
							href="/community"
							className="btn-glass-dark px-8 py-4 text-sm font-bold"
						>
							{tp("browseCommunity")}
						</Link>
					</div>
					<div className="hero-ring" aria-hidden="true" />
				</section>
			</Reveal>
		</div>
	);
}

export default withPublicPagePerformance("/", Home);
