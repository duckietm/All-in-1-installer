import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { requestReset } from "@/actions/password-reset";
import { CaptchaWidget } from "@/components/auth/captcha-widget";
import Link from "@/components/link";
import { ContentCard } from "@/components/public/ui";
import { captchaConfig } from "@/lib/services/captcha";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.forgot");
	return {
		title: t("title"),
		description: t("subtitle"),
		robots: { index: false, follow: false },
	};
}

export default async function ForgotPage({
	searchParams,
}: {
	searchParams: Promise<{ sent?: string; error?: string }>;
}) {
	const t = await getTranslations("pages.forgot");
	const { sent, error } = await searchParams;
	const cfg = await captchaConfig();
	const nonce = (await headers()).get("x-nonce") ?? undefined;

	return (
		<section style={{ maxWidth: 420, margin: "2rem auto" }}>
			<ContentCard icon="🔑" title={t("title")} subtitle={t("subtitle")}>
				{sent ? (
					<>
						<p className="muted" style={{ textAlign: "center", margin: 0 }}>
							{t("sentNotice")}
						</p>
						{/* A mail that never arrived must be retryable from here,
						    otherwise the visitor is stuck on a dead end. */}
						<form
							action={requestReset}
							style={{ display: "grid", gap: "0.7rem", marginTop: "1rem" }}
						>
							<input
								name="email"
								type="email"
								placeholder={t("emailPlaceholder")}
								autoComplete="email"
								required
							/>
							<CaptchaWidget
								captcha={{
									provider: cfg.provider,
									siteKey: cfg.siteKey || undefined,
									field: cfg.field || undefined,
								}}
								nonce={nonce}
							/>
							<button type="submit" className="btn btn-primary">
								{t("sendAnotherLink")}
							</button>
						</form>
					</>
				) : (
					<form
						action={requestReset}
						style={{ display: "grid", gap: "0.7rem" }}
					>
						<input
							name="email"
							type="email"
							placeholder={t("emailPlaceholder")}
							autoComplete="email"
							required
						/>
						<CaptchaWidget
							captcha={{
								provider: cfg.provider,
								siteKey: cfg.siteKey || undefined,
								field: cfg.field || undefined,
							}}
							nonce={nonce}
						/>
						{error === "captcha" ? (
							<p
								style={{
									color: "var(--color-danger)",
									textAlign: "center",
									margin: 0,
								}}
							>
								{t("errorCaptcha")}
							</p>
						) : null}
						<button type="submit" className="btn btn-primary">
							{t("sendResetLink")}
						</button>
					</form>
				)}
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
