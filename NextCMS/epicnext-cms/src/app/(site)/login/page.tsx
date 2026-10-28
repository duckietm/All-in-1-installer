import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthAlert } from "@/components/auth/auth-alert";
import {
	AuthLandingView,
	loadAuthLanding,
} from "@/components/auth/auth-landing";
import { LoginForm } from "@/components/auth/login-form";
import { auth } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.login");
	const title = t("title");
	const description = t("subtitle");
	return {
		title,
		description,
		// Sign-in is a dead end for crawlers and duplicates the homepage copy.
		robots: { index: false, follow: false },
		openGraph: { title, description, type: "website" },
	};
}

export default async function LoginPage({
	searchParams,
}: {
	searchParams: Promise<{
		from?: string;
		registered?: string;
		reset?: string;
	}>;
}) {
	const t = await getTranslations("pages.login");
	const sp = await searchParams;
	const redirectTo = safeRedirectPath(sp.from);

	// Already signed in: the form has nothing to do here. Honour `from` first so
	// an admin bounced off /admin lands back where they were heading.
	const session = await auth();
	if (session?.user?.id) redirect(redirectTo);

	const data = await loadAuthLanding();

	// `/login?registered=1` is where the sign-up form lands when it could not
	// auto sign-in (e-mail verification still pending). Without this notice the
	// visitor would only see an empty login form and no sign their account
	// exists. `?reset=1` comes from a successful password reset; saying so
	// matters because a silent form reads like the reset failed.
	const notice =
		sp.registered === "1" ? (
			<AuthAlert variant="success" className="mb-4">
				{t("registeredSuccess")}
			</AuthAlert>
		) : sp.reset === "1" ? (
			<AuthAlert variant="success" className="mb-4">
				{t("passwordChanged")}
			</AuthAlert>
		) : undefined;

	return (
		<AuthLandingView
			data={data}
			copy={{
				title: t("title"),
				subtitle: t("subtitle"),
				notice,
				promoTitle: t("welcomeBack"),
				promoSubtitle: t("welcomeBackSub", { hotelName: data.hotelName }),
				usersOnlineLabel: t("usersOnline", { count: data.online }),
				whoIsOnlineLabel: t("whoIsOnline"),
				newestCitizensLabel: t("newestCitizens"),
			}}
			form={
				<LoginForm
					redirectTo={redirectTo}
					captcha={data.captcha}
					nonce={data.nonce}
				/>
			}
		/>
	);
}
