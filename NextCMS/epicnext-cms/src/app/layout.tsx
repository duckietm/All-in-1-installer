import type { Metadata } from "next";
import { Nunito, Pixelify_Sans } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { type ReactNode, Suspense } from "react";
import { GlobalProgressBar } from "@/components/global-progress-bar";
import { ScopedThemeVars } from "@/components/scoped-theme-vars";
import { ThemeScopeDetector } from "@/components/theme-scope-detector";
import { ThemeVars } from "@/components/theme-vars";
import { enforceSiteAccess } from "@/lib/access-guard";
import { getDefaultFaviconDataUri } from "@/lib/default-favicon";
import { resolveHotelName } from "@/lib/hotel-name";
import { publicClientMessages } from "@/lib/i18n-client-messages";
import { siteSettings } from "@/lib/services/site-settings";
import "./globals.css";

const nunito = Nunito({
	subsets: ["latin"],
	weight: ["400", "600", "700", "800"],
	variable: "--font-nunito",
	display: "swap",
});

const pixelify = Pixelify_Sans({
	subsets: ["latin"],
	weight: ["400", "700"],
	variable: "--font-pixel",
	display: "swap",
});

// The root layout reads runtime data (locale cookie, request headers via
// enforceSiteAccess, DB-backed site settings) to render the <html> element,
// which cannot be wrapped in <Suspense>. Child pages inherit this opt-out,
// so leaf pages that only access cached/DB data stay instant.
// export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
	const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(
		/\/+$/,
		"",
	);
	const hotel = await resolveHotelName();
	const customFavicon = await siteSettings.get("cms_favicon");
	const faviconUrl = customFavicon ?? getDefaultFaviconDataUri();
	const icons = [
		{ rel: "icon", url: faviconUrl },
		{ rel: "shortcut icon", url: faviconUrl },
	];
	return {
		title: { default: `${hotel} - Hotel`, template: `%s · ${hotel}` },
		description: `${hotel} — a Habbo retro hotel. Hang out, collect furni and meet friends.`,
		metadataBase: new URL(appUrl),
		alternates: {
			canonical: appUrl,
			types: { "application/rss+xml": `${appUrl}/news/rss.xml` },
		},
		icons,
		openGraph: {
			title: `${hotel} - Hotel`,
			description: `${hotel} — a Habbo retro hotel. Hang out, collect furni and meet friends.`,
			type: "website",
			siteName: hotel,
			images: [
				{
					url: `${appUrl}/assets/images/next_header.jpg`,
					alt: `${hotel} - Hotel`,
				},
			],
		},
		twitter: {
			card: "summary_large_image",
			title: `${hotel} - Hotel`,
			images: [`${appUrl}/assets/images/next_header.jpg`],
		},
	};
}

export default async function RootLayout({
	children,
}: {
	children: ReactNode;
}) {
	await enforceSiteAccess();
	const locale = await getLocale();
	// Only the namespaces non-staff routes can reach: the full catalogue is
	// ~254 KB and would otherwise be serialised into every public page's RSC
	// payload. `/admin`, `/admin-next` and `/mod` install a nested provider
	// seeded with the full set (see i18n-client-messages).
	const messages = publicClientMessages(await getMessages());
	const defaultDark = await siteSettings.getBool("default_dark", false);
	const nitroUrl = await siteSettings.get("nitro_client_url", "");
	const nonce = (await headers()).get("x-nonce") ?? undefined;

	return (
		<html
			lang={locale}
			className={`app ${nunito.variable} ${pixelify.variable}`}
			suppressHydrationWarning
		>
			<head>
				<meta name="theme-default-dark" content={String(defaultDark)} />
				{/* Scroll-revealed content starts transparent and is only shown by a
				    client-side animation. Without JavaScript that animation never
				    runs, so force it visible instead of leaving the page blank. */}
				<noscript>
					<style>{".motion-reveal{opacity:1 !important}"}</style>
				</noscript>
				<Script
					src="/scripts/theme-init.js"
					strategy="beforeInteractive"
					nonce={nonce}
				/>
				<link rel="preconnect" href="https://www.habbo.com" />
				{nitroUrl?.startsWith("http") ? (
					<link rel="preconnect" href={new URL(nitroUrl).origin} />
				) : null}
			</head>
			<body
				className="flex min-h-screen flex-col site-bg"
				style={{ backgroundColor: "var(--color-background)" }}
			>
				<Suspense fallback={null}>
					<GlobalProgressBar />
				</Suspense>
				<NextIntlClientProvider locale={locale} messages={messages}>
					<ThemeVars nonce={nonce} />
					<ScopedThemeVars nonce={nonce} />
					<ThemeScopeDetector />
					{children}
				</NextIntlClientProvider>
			</body>
		</html>
	);
}
