import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
	AuthLandingView,
	loadAuthLanding,
} from "@/components/auth/auth-landing";
import { RegisterForm } from "@/components/auth/register-form";
import { auth } from "@/lib/auth";
import { passwordPolicy } from "@/lib/auth/password-policy";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.register");
	const title = t("title");
	const description = t("subtitle");
	return {
		title,
		description,
		robots: { index: false, follow: false },
		openGraph: { title, description, type: "website" },
	};
}

export default async function RegisterPage() {
	const t = await getTranslations("pages.register");

	// An account already exists in this browser — there is nothing to sign up.
	const session = await auth();
	if (session?.user?.id) redirect("/me");

	const data = await loadAuthLanding();

	return (
		<AuthLandingView
			data={data}
			copy={{
				title: t("title"),
				subtitle: t("subtitle"),
				promoTitle: t("subtitle"),
				promoSubtitle: undefined,
				usersOnlineLabel: t("usersOnline", { count: data.online }),
				whoIsOnlineLabel: t("whoIsOnline"),
				newestCitizensLabel: t("newestCitizens"),
			}}
			form={
				<RegisterForm
					hotelName={data.hotelName}
					captcha={data.captcha}
					nonce={data.nonce}
					passwordMinLength={passwordPolicy.minLength}
					passwordMaxLength={passwordPolicy.maxLength}
				/>
			}
		/>
	);
}
