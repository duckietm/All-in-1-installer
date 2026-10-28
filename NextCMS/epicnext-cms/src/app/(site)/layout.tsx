import dynamic from "next/dynamic";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { CloudsField } from "@/components/clouds-field";
import MotionPageWrapper from "@/components/motion-page-wrapper";
import { Navigation } from "@/components/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { TopHeader } from "@/components/top-header";
import { auth } from "@/lib/auth";
import { publicClientMessages } from "@/lib/i18n-client-messages";

const RadioPlayerGate = dynamic(
	() => import("@/components/public/radio-player-gate"),
	{
		loading: () => (
			<div className="animate-pulse bg-[var(--admin-surface)] rounded h-12" />
		),
	},
);

/**
 * Public site chrome. Route group `(site)` keeps this off `/admin` and `/client`,
 * so housekeeping is never constrained by the public max-w-7xl grid.
 *
 * The message provider lives here rather than only in the root layout: nested
 * NextIntlClientProviders replace the parent set instead of merging, so this is
 * where the public catalogue is installed — without the ~177 KB of staff-tool
 * namespaces that no page in this group can reach.
 */
export default async function SiteLayout({
	children,
}: {
	children: ReactNode;
}) {
	const [session, locale, messages, h] = await Promise.all([
		auth(),
		getLocale(),
		getMessages(),
		headers(),
	]);
	const clientMessages = publicClientMessages(messages);

	// The landing pages render their own AuthTopBar (logo + live online), so the
	// global site banner / navigation is hidden there to keep them clean and
	// avoid showing the same chrome twice. Everything else keeps the chrome.
	const pathname = h.get("x-pathname");
	const isLandingPage =
		pathname === "/" || pathname === "/login" || pathname === "/register";

	return (
		<NextIntlClientProvider locale={locale} messages={clientMessages}>
			<CloudsField />
			{/* Site chrome is public: hiding it all for anonymous visitors used to
			    strand them — from /news, /leaderboard or /shop there was no way to
			    reach any other page at all. Only the standalone landing pages opt
			    out, because they carry their own header. */}
			{!isLandingPage && (
				<div data-theme-block="top_header">
					<TopHeader session={session} />
				</div>
			)}
			{!isLandingPage && (
				<div data-theme-block="site_header">
					<SiteHeader />
				</div>
			)}
			{!isLandingPage && (
				<div data-theme-block="navigation">
					<Navigation session={session} />
				</div>
			)}
			<main>
				<div
					data-theme-block="content_grid"
					className="mx-auto mt-4 grid max-w-7xl grid-cols-12 gap-x-3 gap-y-5 px-3 py-3 sm:px-4 sm:py-4 md:mt-0 md:px-6 md:py-6 md:gap-y-6"
				>
					<div className="col-span-12 min-w-0">
						<div data-theme-block="page_transition">
							<MotionPageWrapper>{children}</MotionPageWrapper>
						</div>
					</div>
				</div>
			</main>
			<div data-theme-block="footer">
				<SiteFooter />
			</div>
			<div data-theme-block="radio_player">
				<RadioPlayerGate />
			</div>
		</NextIntlClientProvider>
	);
}
