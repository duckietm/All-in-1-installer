import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import {
	AuthPageFrame,
	AuthUsersCards,
	type PublicUser,
} from "@/components/auth/auth-page-frame";
import { AuthPromoCard } from "@/components/auth/auth-promo-card";
import type { CaptchaPublicConfig } from "@/components/auth/captcha-widget";
import { cached } from "@/lib/cache";
import { db, User } from "@/lib/db";
import { resolveHotelName } from "@/lib/hotel-name";
import { captchaConfig } from "@/lib/services/captcha";
import { cachedOnlineCount } from "@/lib/services/public-counters";
import { siteSettings } from "@/lib/services/site-settings";

export interface AuthLandingData {
	hotelName: string;
	logo: string | null;
	nonce?: string;
	/** Ready to spread onto a form's `captcha` prop (secrets never included). */
	captcha: CaptchaPublicConfig;
	online: number;
	recentUsers: PublicUser[];
	latestUsers: PublicUser[];
}

/**
 * Everything `/login` and `/register` need around their form: hotel identity,
 * captcha config, the CSP nonce and the "who is online" / "newest citizens"
 * rails. The rosters are memoised, so both pages share one cache entry. Kept in
 * one place because the two landing pages are otherwise identical.
 */
export async function loadAuthLanding(): Promise<AuthLandingData> {
	const [hotelName, cfg, logo] = await Promise.all([
		resolveHotelName(),
		captchaConfig(),
		siteSettings.get("cms_logo", ""),
	]);
	const captcha: CaptchaPublicConfig = {
		provider: cfg.provider,
		siteKey: cfg.siteKey || undefined,
		field: cfg.field || undefined,
	};
	const nonce = (await headers()).get("x-nonce") ?? undefined;

	const [online, recentUsers, latestUsers] = await Promise.all([
		cachedOnlineCount().catch(() => 0),
		cached(
			"auth_online_users",
			10_000,
			() =>
				db
					.select({ id: User.id, username: User.username, look: User.look })
					.from(User)
					.where(eq(User.online, "1"))
					.limit(8),
			{ staleMs: 30000 },
		).catch(() => []),
		cached(
			"auth_latest_users",
			30_000,
			() =>
				db
					.select({ id: User.id, username: User.username, look: User.look })
					.from(User)
					.orderBy(desc(User.accountCreated))
					.limit(8),
			{ staleMs: 60000 },
		).catch(() => []),
	]);

	return { hotelName, captcha, logo, nonce, online, recentUsers, latestUsers };
}

/** Locale-resolved strings the landing frame needs, keyed to the page. */
export interface AuthLandingCopy {
	title: string;
	subtitle: ReactNode;
	/** Optional success notice rendered above the form (e.g. "registered"). */
	notice?: ReactNode;
	promoTitle: ReactNode;
	promoSubtitle?: ReactNode;
	usersOnlineLabel: string;
	whoIsOnlineLabel: string;
	newestCitizensLabel: string;
}

interface AuthLandingViewProps {
	data: AuthLandingData;
	copy: AuthLandingCopy;
	form: ReactNode;
}

/**
 * Presentational shell shared by the auth landing pages: top bar, promo panel
 * and user rails around a caller-supplied form. All data and copy come from the
 * page so this component stays free of queries and translations.
 */
export function AuthLandingView({ data, copy, form }: AuthLandingViewProps) {
	return (
		<AuthPageFrame
			hotelName={data.hotelName}
			logo={data.logo}
			online={data.online}
			title={copy.title}
			subtitle={copy.subtitle}
			notice={copy.notice}
			form={form}
		>
			<AuthPromoCard
				onlineLabel={copy.usersOnlineLabel}
				title={copy.promoTitle}
				subtitle={copy.promoSubtitle}
			/>
			<AuthUsersCards
				recentUsers={data.recentUsers}
				latestUsers={data.latestUsers}
				recentTitle={copy.whoIsOnlineLabel}
				latestTitle={copy.newestCitizensLabel}
			/>
		</AuthPageFrame>
	);
}
