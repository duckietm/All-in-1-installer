import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resetPassword } from "@/actions/password-reset";
import Link from "@/components/link";
import { ContentCard } from "@/components/public/ui";
import { passwordPolicy } from "@/lib/auth/password-policy";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.reset");
	return {
		title: t("title"),
		description: t("subtitle"),
		// Single-use links: never indexable.
		robots: { index: false, follow: false },
	};
}

const ERROR_KEYS: Record<string, string> = {
	password: "passwordMinLength",
	ratelimit: "tooManyAttempts",
	invalid: "invalidLink",
	failed: "failed",
};

export default async function ResetPage({
	searchParams,
}: {
	searchParams: Promise<{ email?: string; token?: string; error?: string }>;
}) {
	const t = await getTranslations("pages.reset");
	const { email = "", token = "", error } = await searchParams;
	// Only codes the action can produce are mapped — anything else stays silent
	// instead of being echoed back onto our own domain.
	const errorKey = error ? (ERROR_KEYS[error] ?? null) : null;

	return (
		<section style={{ maxWidth: 420, margin: "2rem auto" }}>
			<ContentCard icon="🔐" title={t("title")} subtitle={t("subtitle")}>
				<form action={resetPassword} style={{ display: "grid", gap: "0.7rem" }}>
					<input type="hidden" name="email" value={email} />
					<input type="hidden" name="token" value={token} />
					<input
						name="password"
						type="password"
						placeholder={t("passwordPlaceholder", {
							min: passwordPolicy.minLength,
						})}
						autoComplete="new-password"
						minLength={passwordPolicy.minLength}
						maxLength={passwordPolicy.maxLength}
						required
					/>
					<button type="submit" className="btn btn-primary">
						{t("resetPassword")}
					</button>
				</form>
				{errorKey ? (
					<p
						role="alert"
						style={{
							color: "var(--color-danger)",
							textAlign: "center",
							marginBottom: 0,
						}}
					>
						{t(errorKey, { min: passwordPolicy.minLength })}
					</p>
				) : null}
				<p
					className="muted"
					style={{ textAlign: "center", marginBottom: 0, marginTop: "1rem" }}
				>
					<Link href="/login">{t("backToLogin")}</Link>
				</p>
			</ContentCard>
		</section>
	);
}
