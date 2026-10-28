import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
	beginTwoFactor,
	confirmTwoFactor,
	disableTwoFactor,
} from "@/actions/twofactor";
import Link from "@/components/link";
import { ContentCard } from "@/components/public/ui";
import { env } from "@/env";
import { auth } from "@/lib/auth";
import { LaravelEncrypter } from "@/lib/auth/laravel-encrypter";
import { totpKeyUri } from "@/lib/auth/totp";
import { db, User } from "@/lib/db";
import { resolveHotelName } from "@/lib/hotel-name";

export default async function TwoFactorPage({
	searchParams,
}: {
	searchParams: Promise<{
		error?: string;
		enabled?: string;
		disabled?: string;
	}>;
}) {
	const t = await getTranslations("pages.settings2fa");
	const session = await auth();
	if (!session?.user?.id) redirect("/login");
	const sp = await searchParams;
	const id = Number(session.user.id);

	let user: {
		twoFactorSecret: string | null;
		twoFactorConfirmedAt: Date | null;
		twoFactorRecoveryCodes: string | null;
	} | null = null;
	try {
		const [row] = await db
			.select({
				twoFactorSecret: User.twoFactorSecret,
				twoFactorConfirmedAt: User.twoFactorConfirmedAt,
				twoFactorRecoveryCodes: User.twoFactorRecoveryCodes,
			})
			.from(User)
			.where(eq(User.id, id))
			.limit(1);
		user = row ?? null;
	} catch {
		user = null;
	}

	const hasAppKey = Boolean(env.APP_KEY);
	const enabled = Boolean(user?.twoFactorConfirmedAt);
	const pending = Boolean(user?.twoFactorSecret && !user?.twoFactorConfirmedAt);
	const hotelName = await resolveHotelName();

	let secret = "";
	let uri = "";
	let recoveryCodes: string[] = [];
	if (pending && hasAppKey && user?.twoFactorSecret) {
		try {
			secret = new LaravelEncrypter(env.APP_KEY as string).decrypt(
				user.twoFactorSecret,
			);
			uri = totpKeyUri(secret, session.user.name ?? "user", hotelName);
			if (user.twoFactorRecoveryCodes) {
				recoveryCodes = JSON.parse(user.twoFactorRecoveryCodes) as string[];
			}
		} catch {
			secret = "";
		}
	}

	return (
		<section
			style={{
				display: "grid",
				gap: "1.5rem",
				maxWidth: 560,
				margin: "0 auto",
			}}
		>
			<p className="muted" style={{ margin: 0 }}>
				<Link href="/settings">{t("backToSettings")}</Link>
			</p>

			<ContentCard icon="🔒" title={t("title")} subtitle={t("subtitle")}>
				{sp.enabled ? (
					<>
						<p style={{ color: "var(--color-accent)", marginTop: 0 }}>
							{t("nowEnabled")}
						</p>
						<div
							style={{
								background: "var(--color-surface)",
								border: "1px solid var(--color-border)",
								borderRadius: 8,
								padding: "1rem",
								marginTop: "0.5rem",
							}}
						>
							<h4 style={{ margin: "0 0 0.5rem" }}>Recovery Codes</h4>
							<p
								className="muted"
								style={{ fontSize: "0.85rem", margin: "0 0 0.75rem" }}
							>
								Store these one-time use codes in a safe place. Each can be used
								once if you lose access to your authenticator app.
							</p>
							<div
								style={{
									display: "grid",
									gridTemplateColumns: "1fr 1fr",
									gap: "0.25rem",
									fontFamily: "monospace",
									fontSize: "0.9rem",
								}}
							>
								{recoveryCodes.map((code) => (
									<code
										key={code}
										style={{
											userSelect: "all",
											padding: "0.25rem 0.5rem",
											background: "var(--color-background)",
											borderRadius: 4,
										}}
									>
										{code}
									</code>
								))}
							</div>
						</div>
					</>
				) : null}
				{sp.disabled ? (
					<p className="muted" style={{ marginTop: 0 }}>
						{t("disabledNotice")}
					</p>
				) : null}
				{sp.error === "badcode" ? (
					<p style={{ color: "var(--color-danger)", marginTop: 0 }}>
						{t("badCode")}
					</p>
				) : null}
				{sp.error === "ratelimit" ? (
					<p style={{ color: "var(--color-danger)", marginTop: 0 }}>
						{t("rateLimit")}
					</p>
				) : null}
				{sp.error === "alreadyenabled" ? (
					<p style={{ color: "var(--color-danger)", marginTop: 0 }}>
						{t("alreadyEnabled")}
					</p>
				) : null}

				{!hasAppKey ? (
					<p style={{ margin: 0 }}>
						{t("noAppKeyPrefix")} <code>APP_KEY</code> {t("noAppKeyMiddle")}
						<code> APP_KEY</code> {t("noAppKeySuffix")}
					</p>
				) : enabled ? (
					<>
						<p style={{ marginTop: 0 }}>
							<strong>{t("isEnabled")}</strong> {t("onYourAccount")}
						</p>
						<form
							action={disableTwoFactor}
							style={{ display: "flex", gap: "0.5rem" }}
						>
							<input
								name="code"
								placeholder={t("codePlaceholder")}
								inputMode="numeric"
								required
							/>
							<button type="submit" className="btn btn-danger">
								{t("disable")}
							</button>
						</form>
					</>
				) : pending ? (
					<>
						<h3 style={{ marginTop: 0 }}>{t("scanOrEnter")}</h3>
						<p className="muted" style={{ marginTop: 0 }}>
							{t("scanInstructions")}
						</p>
						<p>
							{t("manualKey")}{" "}
							<code style={{ userSelect: "all" }}>{secret}</code>
						</p>
						<p
							className="muted"
							style={{ wordBreak: "break-all", fontSize: "0.8rem" }}
						>
							{uri}
						</p>
						<form
							action={confirmTwoFactor}
							style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}
						>
							<input
								name="code"
								placeholder={t("codePlaceholder")}
								inputMode="numeric"
								required
							/>
							<button type="submit" className="btn btn-primary">
								{t("confirm")}
							</button>
						</form>
					</>
				) : (
					<>
						<p style={{ marginTop: 0 }}>{t("enableIntro")}</p>
						<form action={beginTwoFactor}>
							<button type="submit" className="btn btn-primary">
								{t("enable")}
							</button>
						</form>
					</>
				)}
			</ContentCard>
		</section>
	);
}
