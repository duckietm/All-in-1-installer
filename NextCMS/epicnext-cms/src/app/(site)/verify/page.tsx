import { asc, eq } from "drizzle-orm";
import { CheckCircle2, Clock, MailX } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { ResendVerificationForm } from "@/components/auth/resend-verification-form";
import Link from "@/components/link";
import { SurfaceCard } from "@/components/surface-card";
import { isValidVerificationToken } from "@/lib/auth/email-verification";
import { db, User } from "@/lib/db";
import { captchaConfig } from "@/lib/services/captcha";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.verify");
	return {
		title: t("verifiedTitle"),
		description: t("invalidSubtitle"),
		// Token links are single-use; the page itself has nothing to index.
		robots: { index: false, follow: false },
	};
}

type Status = "verified" | "already" | "invalid" | "unavailable";

function StatusCard({
	icon,
	title,
	subtitle,
	children,
	color,
}: {
	icon: React.ReactNode;
	title: string;
	subtitle: string;
	children: React.ReactNode;
	color: string;
}) {
	const tintMap: Record<string, string> = {
		green: "#16a34a",
		yellow: "#d97706",
		red: "#dc2626",
		blue: "#2563eb",
	};
	const tint = tintMap[color] ?? tintMap.blue;

	return (
		<section className="flex min-h-[60vh] items-center justify-center px-4">
			<SurfaceCard className="w-full max-w-md">
				<div
					className="flex items-center gap-2.5 border-b px-5 py-4"
					style={{
						background: `color-mix(in srgb, ${tint} 12%, var(--color-surface))`,
						borderColor:
							"color-mix(in srgb, var(--color-text-muted) 10%, transparent)",
					}}
				>
					<span
						className="flex h-7 w-7 items-center justify-center rounded-lg"
						style={{
							background: `color-mix(in srgb, ${tint} 18%, transparent)`,
							color: tint,
						}}
					>
						{icon}
					</span>
					<h1
						className="text-sm font-bold tracking-tight"
						style={{ color: "var(--color-text-readable)" }}
					>
						{title}
					</h1>
				</div>
				<div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
					<div
						className="flex h-16 w-16 items-center justify-center rounded-full"
						style={{
							background: `color-mix(in srgb, ${tint} 12%, transparent)`,
							color: tint,
						}}
					>
						{icon}
					</div>
					<p
						className="text-sm font-semibold"
						style={{ color: "var(--color-text-muted)" }}
					>
						{subtitle}
					</p>
					{children}
				</div>
			</SurfaceCard>
		</section>
	);
}

export default async function VerifyPage({
	searchParams,
}: {
	searchParams: Promise<{
		token?: string;
		email?: string;
	}>;
}) {
	const t = await getTranslations("pages.verify");
	const { token = "", email = "" } = await searchParams;
	const normalisedEmail = email.trim().toLowerCase();

	// The resend form triggers real outbound mail, so it carries the same
	// captcha as the login/register forms.
	const cfg = await captchaConfig();
	const nonce = (await headers()).get("x-nonce") ?? undefined;

	let status: Status = "invalid";

	if (normalisedEmail && token) {
		const ok = await isValidVerificationToken(normalisedEmail, token);
		if (ok) {
			try {
				// Legacy databases allow duplicate addresses; always resolve the
				// oldest account so the link cannot verify a different one.
				const matches = await db
					.select({ id: User.id, mailVerified: User.mailVerified })
					.from(User)
					.where(eq(User.mail, normalisedEmail))
					.orderBy(asc(User.id));
				const user = matches[0];
				if (!user) {
					status = "invalid";
				} else if (user.mailVerified === "1") {
					status = "already";
				} else {
					await db
						.update(User)
						.set({ mailVerified: "1" })
						.where(eq(User.id, user.id));
					status = "verified";
				}
			} catch {
				status = "unavailable";
			}
		}
	}

	const linkClass =
		"btn-shine inline-flex items-center gap-2 font-extrabold text-sm px-6 py-3 rounded-xl transition-all duration-200 hover:scale-[1.02] active:scale-95 shadow-lg";
	const linkStyle = {
		background: "var(--color-primary)",
		color: "var(--color-primary-foreground)",
		boxShadow:
			"0 4px 20px color-mix(in srgb, var(--color-primary) 30%, transparent)",
	};

	return (
		<>
			{status === "verified" && (
				<StatusCard
					icon={<CheckCircle2 size={22} />}
					title={t("verifiedTitle")}
					subtitle={t("verifiedSubtitle")}
					color="green"
				>
					<p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
						{t("verifiedBody")}
					</p>
					<Link href="/login" className={linkClass} style={linkStyle}>
						{t("goToLogin")}
					</Link>
				</StatusCard>
			)}

			{status === "already" && (
				<StatusCard
					icon={<CheckCircle2 size={22} />}
					title={t("alreadyTitle")}
					subtitle={t("alreadySubtitle")}
					color="yellow"
				>
					<p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
						{t("alreadyBody")}
					</p>
					<Link href="/login" className={linkClass} style={linkStyle}>
						{t("goToLogin")}
					</Link>
				</StatusCard>
			)}

			{status === "unavailable" && (
				<StatusCard
					icon={<Clock size={22} />}
					title={t("unavailableTitle")}
					subtitle={t("unavailableSubtitle")}
					color="blue"
				>
					<p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
						{t("unavailableBody")}
					</p>
					{/* Transient failure: offer both the retry path and the way out
					    instead of leaving the visitor stranded on this card. */}
					<ResendVerificationForm captcha={cfg} nonce={nonce} />
					<Link
						href="/login"
						className={`${linkClass} !shadow-none`}
						style={{
							background: "transparent",
							color: "var(--color-text-readable)",
							border:
								"2px solid color-mix(in srgb, var(--color-text-muted) 20%, transparent)",
						}}
					>
						{t("backToLogin")}
					</Link>
				</StatusCard>
			)}

			{status === "invalid" && (
				<StatusCard
					icon={<MailX size={22} />}
					title={t("invalidTitle")}
					subtitle={t("invalidSubtitle")}
					color="red"
				>
					<p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
						{t("invalidBody")}
					</p>
					<ResendVerificationForm captcha={cfg} nonce={nonce} />
					<Link
						href="/login"
						className={`${linkClass} !shadow-none`}
						style={{
							background: "transparent",
							color: "var(--color-text-readable)",
							border:
								"2px solid color-mix(in srgb, var(--color-text-muted) 20%, transparent)",
						}}
					>
						{t("backToLogin")}
					</Link>
				</StatusCard>
			)}
		</>
	);
}
