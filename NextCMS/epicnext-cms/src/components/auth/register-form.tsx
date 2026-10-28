"use client";

import {
	Check,
	KeyRound,
	Lock,
	type LucideIcon,
	Mail,
	ShieldCheck,
	UserRound,
	X,
} from "lucide-react";
import Script from "next/script";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef, useState } from "react";
import {
	type RegisterErrorCode,
	type RegisterState,
	register,
} from "@/actions/register";
import { AuthAlert } from "@/components/auth/auth-alert";
import { AuthField } from "@/components/auth/auth-field";
import { PasswordToggle } from "@/components/auth/password-toggle";
import Link from "@/components/link";
import { signInWithTransientRetry } from "@/lib/auth/sign-in-retry";

interface RegisterFormProps {
	hotelName: string;
	captcha: { provider: string; siteKey?: string };
	error?: string;
	nonce?: string;
	/** Effective policy from `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH`. */
	passwordMinLength: number;
	passwordMaxLength: number;
}

function passwordStrength(
	pw: string,
	t: (key: string) => string,
	minLength: number,
): {
	score: number;
	label: string;
	color: string;
} {
	let score = 0;
	if (pw.length >= minLength) score += 1;
	if (pw.length >= minLength + 4) score += 1;
	if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
	if (/\d/.test(pw)) score += 1;
	if (/[^a-zA-Z0-9]/.test(pw)) score += 1;

	if (score <= 1) return { score, label: t("strengthWeak"), color: "#ef4444" };
	if (score <= 2) return { score, label: t("strengthFair"), color: "#f59e0b" };
	if (score <= 3) return { score, label: t("strengthGood"), color: "#22c55e" };
	return { score: 5, label: t("strengthStrong"), color: "#16a34a" };
}

/** The numbered section rule above each group of fields ("01 Account", ...). */
function AuthSectionHeader({
	icon: Icon,
	label,
	step,
}: {
	icon: LucideIcon;
	label: string;
	step: string;
}) {
	const accent = "var(--color-primary-readable, var(--color-primary))";
	return (
		<div className="flex items-center gap-2.5">
			<span
				aria-hidden="true"
				className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
				style={{
					background:
						"color-mix(in srgb, var(--color-primary) 12%, transparent)",
					boxShadow:
						"inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 22%, transparent)",
				}}
			>
				<Icon className="h-3.5 w-3.5" style={{ color: accent }} />
			</span>
			<span
				className="text-[11px] font-black uppercase tracking-widest"
				style={{ color: accent }}
			>
				{label}
			</span>
			<span
				className="h-px flex-1"
				style={{
					background:
						"linear-gradient(90deg, color-mix(in srgb, var(--color-text-muted) 18%, transparent), transparent)",
				}}
			/>
			<span aria-hidden="true" className="number-mark text-lg">
				{step}
			</span>
		</div>
	);
}

export function RegisterForm({
	hotelName,
	captcha,
	error,
	nonce,
	passwordMinLength,
	passwordMaxLength,
}: RegisterFormProps) {
	const t = useTranslations("pages.register");
	const showCaptcha = captcha.provider !== "none" && !!captcha.siteKey;
	const [state, formAction, isPending] = useActionState<
		RegisterState,
		FormData
	>(register, { error: null, ok: false });

	/**
	 * Prefer the locale-independent `code` so the message follows the visitor's
	 * language, falling back to the server's English string when a code has no
	 * translation yet.
	 */
	const translateErrorCode = (code: RegisterErrorCode | undefined) => {
		if (!code) return null;
		try {
			return t(code);
		} catch {
			return null;
		}
	};
	const errorMessage = error ?? translateErrorCode(state.code) ?? state.error;
	const [termsAccepted, setTermsAccepted] = useState(false);
	const [termsError, setTermsError] = useState(false);
	const termsRef = useRef<HTMLDivElement>(null);
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [showConfirm, setShowConfirm] = useState(false);
	const [signingIn, setSigningIn] = useState(false);
	const credentialsRef = useRef<{ username: string; password: string } | null>(
		null,
	);
	const autoLoginStartedRef = useRef(false);
	const [referralCode, setReferralCode] = useState("");
	const strength = passwordStrength(password, t, passwordMinLength);

	/**
	 * The password policy the server enforces, evaluated live so the visitor can
	 * see which rule they are still missing instead of submitting and reading a
	 * single error back.
	 */
	const requirements = [
		{
			label: t("passwordMinLength", { min: passwordMinLength }),
			met: password.length >= passwordMinLength,
		},
		{ label: t("passwordUpper"), met: /[A-Z]/.test(password) },
		{ label: t("passwordLower"), met: /[a-z]/.test(password) },
		{ label: t("passwordDigit"), met: /\d/.test(password) },
		{ label: t("passwordSpecial"), met: /[^A-Za-z0-9]/.test(password) },
	];
	/** Shown as soon as the confirmation is filled in and disagrees. */
	const mismatch = confirmPassword.length > 0 && confirmPassword !== password;

	// The invite link is `/register?ref=<username>`; read it client-side so the
	// attribution travels with the sign-up form without server state.
	useEffect(() => {
		const ref = new URLSearchParams(window.location.search).get("ref");
		if (ref) setReferralCode(ref);
	}, []);

	// Successful sign-up: sign in with the submitted credentials and go
	// straight to /me. If the automatic sign-in is refused (e.g. email
	// verification required), fall back to the regular login page.
	useEffect(() => {
		if (!state.ok || autoLoginStartedRef.current) return;
		autoLoginStartedRef.current = true;

		const creds = credentialsRef.current;
		if (!creds) {
			window.location.href = "/login?registered=1";
			return;
		}

		let cancelled = false;
		setSigningIn(true);
		(async () => {
			try {
				const res = await signInWithTransientRetry(() =>
					signIn("credentials", { ...creds, code: "", redirect: false }),
				);
				if (!cancelled && res && !res.error) {
					window.location.href = "/me";
					return;
				}
			} catch {
				/* fall through to fallback below */
			}
			if (!cancelled) window.location.href = "/login?registered=1";
		})();

		return () => {
			cancelled = true;
		};
	}, [state.ok]);

	return (
		<div className="mx-auto w-full max-w-[800px]">
			{showCaptcha && captcha.provider === "turnstile" ? (
				<Script
					src="https://challenges.cloudflare.com/turnstile/v0/api.js"
					async
					defer
					nonce={nonce}
				/>
			) : null}
			{showCaptcha && captcha.provider === "recaptcha" ? (
				<Script
					src="https://www.google.com/recaptcha/api.js"
					async
					defer
					nonce={nonce}
				/>
			) : null}
			{/* Form */}
			<form
				action={(fd) => {
					const passwordValue = String(fd.get("password") ?? "");
					const confirmation = String(fd.get("password_confirmation") ?? "");
					// A mismatch is reported live under the field — no round-trip
					// needed just to hear it again from the server.
					if (passwordValue !== confirmation) return;
					credentialsRef.current = {
						username: String(fd.get("username") ?? "").trim(),
						password: passwordValue,
					};
					formAction(fd);
				}}
				className="flex flex-col gap-6"
			>
				{errorMessage && <AuthAlert>{errorMessage}</AuthAlert>}

				{referralCode && (
					<div
						className="animate-fade-in-up flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold"
						style={{
							background:
								"color-mix(in srgb, var(--color-primary) 12%, transparent)",
							color: "var(--color-primary-readable, var(--color-primary))",
							borderColor:
								"color-mix(in srgb, var(--color-primary) 26%, transparent)",
						}}
					>
						{t("invitedBy", { username: referralCode })}
					</div>
				)}

				<input type="hidden" name="ref" value={referralCode} />

				{/* Username & Email */}
				<div className="space-y-2">
					<AuthSectionHeader
						icon={UserRound}
						label={t("accountDetails")}
						step="01"
					/>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-children">
						<AuthField
							id="username"
							name="username"
							label={t("username")}
							icon={UserRound}
							placeholder={t("usernamePlaceholder")}
							autoComplete="username"
							required
						/>
						<AuthField
							id="mail"
							name="mail"
							label={t("email")}
							icon={Mail}
							type="email"
							placeholder={t("emailPlaceholder")}
							autoComplete="email"
						/>
					</div>
				</div>

				{/* Password & Confirm */}
				<div className="space-y-2">
					<AuthSectionHeader
						icon={KeyRound}
						label={t("credentials")}
						step="02"
					/>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-children">
						<AuthField
							id="password"
							name="password"
							label={t("password")}
							icon={Lock}
							type={showPassword ? "text" : "password"}
							value={password}
							onChange={setPassword}
							placeholder={t("passwordPlaceholder", {
								min: passwordMinLength,
							})}
							autoComplete="new-password"
							required
							minLength={passwordMinLength}
							maxLength={passwordMaxLength}
							trailing={
								<PasswordToggle
									show={showPassword}
									onToggle={() => setShowPassword((v) => !v)}
									labelShow={t("showPassword")}
									labelHide={t("hidePassword")}
								/>
							}
						>
							{password.length > 0 && (
								<div className="animate-fade-in-up space-y-1.5 pt-0.5">
									<div className="flex gap-1.5">
										{[1, 2, 3, 4, 5].map((i) => (
											<div
												key={i}
												className="h-1.5 flex-1 rounded-full transition-all duration-300"
												style={{
													backgroundColor:
														i <= strength.score
															? strength.color
															: "color-mix(in srgb, var(--color-text-muted) 18%, transparent)",
													boxShadow:
														i <= strength.score
															? `0 0 8px color-mix(in srgb, ${strength.color} 45%, transparent)`
															: undefined,
												}}
											/>
										))}
									</div>
									<div className="flex items-center gap-1.5">
										<ShieldCheck
											aria-hidden="true"
											className="h-3.5 w-3.5 shrink-0"
											style={{ color: strength.color }}
										/>
										<p
											className="text-[11px] font-extrabold uppercase tracking-wider"
											style={{ color: strength.color }}
										>
											{strength.label}
										</p>
									</div>
								</div>
							)}
							<ul aria-label={t("password")} className="space-y-1 pt-1">
								{requirements.map((r) => (
									<li
										key={r.label}
										className="flex items-center gap-1.5 text-[11px] font-semibold transition-colors duration-200"
										style={{
											color: r.met
												? "var(--color-success)"
												: "var(--color-text-muted)",
										}}
									>
										{r.met ? (
											<Check className="h-3 w-3 shrink-0" aria-hidden="true" />
										) : (
											<X className="h-3 w-3 shrink-0" aria-hidden="true" />
										)}
										{r.label}
									</li>
								))}
							</ul>
						</AuthField>
						<AuthField
							id="password_confirmation"
							name="password_confirmation"
							label={t("confirmPassword")}
							icon={Lock}
							type={showConfirm ? "text" : "password"}
							value={confirmPassword}
							onChange={setConfirmPassword}
							placeholder={t("confirmPasswordPlaceholder")}
							autoComplete="new-password"
							required
							trailing={
								<PasswordToggle
									show={showConfirm}
									onToggle={() => setShowConfirm((v) => !v)}
									labelShow={t("showPassword")}
									labelHide={t("hidePassword")}
								/>
							}
						>
							{mismatch && (
								<p
									className="animate-fade-in-up text-xs font-bold"
									style={{ color: "var(--color-danger)" }}
								>
									{t("passwordsDontMatch")}
								</p>
							)}
						</AuthField>
					</div>
				</div>

				{/* Terms */}
				<div
					ref={termsRef}
					className={`rounded-xl p-4 flex items-center justify-between gap-4 transition-all duration-300 ${
						termsError ? "animate-shake" : ""
					}`}
					style={{
						backgroundColor:
							"color-mix(in srgb, var(--color-background) 50%, var(--color-surface))",
						border: `1px solid ${
							termsError
								? "var(--color-danger)"
								: "color-mix(in srgb, var(--color-text-muted) 12%, transparent)"
						}`,
						boxShadow: termsError
							? "0 0 0 3px color-mix(in srgb, var(--color-danger) 14%, transparent)"
							: undefined,
					}}
				>
					<label
						htmlFor="terms"
						className="group flex flex-1 items-center gap-3 cursor-pointer select-none"
					>
						<input
							type="checkbox"
							id="terms"
							name="terms"
							checked={termsAccepted}
							onChange={(e) => {
								setTermsAccepted(e.target.checked);
								if (e.target.checked) setTermsError(false);
							}}
							aria-invalid={termsError}
							className="peer sr-only"
						/>
						<span
							aria-hidden="true"
							className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition-all duration-300 group-hover:scale-105 group-hover:border-[var(--color-primary)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-primary)]"
							style={{
								borderColor: termsError
									? "var(--color-danger)"
									: termsAccepted
										? "var(--color-primary)"
										: "color-mix(in srgb, var(--color-text-muted) 45%, transparent)",
								background: termsAccepted
									? "var(--color-primary)"
									: "transparent",
								boxShadow: termsAccepted
									? "0 0 18px color-mix(in srgb, var(--color-primary) 40%, transparent)"
									: undefined,
							}}
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="var(--color-primary-foreground)"
								strokeWidth="3.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								className={`transition-all duration-300 ${
									termsAccepted ? "opacity-100 scale-100" : "opacity-0 scale-50"
								}`}
							>
								<title>{t("accepted")}</title>
								<polyline points="20 6 9 17 4 12" />
							</svg>
						</span>
						<span
							className="text-sm font-semibold leading-snug"
							style={{ color: "var(--color-text-readable)" }}
						>
							{t("termsAccept", { hotel: hotelName })}
						</span>
					</label>
					<span
						className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors duration-300"
						style={{
							color: termsError
								? "var(--color-danger)"
								: termsAccepted
									? "var(--color-primary)"
									: "var(--color-text-muted)",
							background: termsError
								? "color-mix(in srgb, var(--color-danger) 10%, transparent)"
								: termsAccepted
									? "color-mix(in srgb, var(--color-primary) 12%, transparent)"
									: "color-mix(in srgb, var(--color-text-muted) 6%, transparent)",
						}}
					>
						{termsError || !termsAccepted ? t("termsRequired") : t("accepted")}
					</span>
				</div>
				{termsError && (
					<p
						className="animate-fade-in-up text-xs font-bold"
						style={{ color: "var(--color-danger)" }}
					>
						{t("termsRequired")}
					</p>
				)}

				{/* Captcha */}
				{showCaptcha && (
					<div className="flex min-h-[70px] items-center justify-center">
						{captcha.provider === "turnstile" && (
							<div className="cf-turnstile" data-sitekey={captcha.siteKey} />
						)}
						{captcha.provider === "recaptcha" && (
							<div className="g-recaptcha" data-sitekey={captcha.siteKey} />
						)}
						{captcha.provider === "hcaptcha" && (
							<div className="h-captcha" data-sitekey={captcha.siteKey} />
						)}
					</div>
				)}

				{/* Submit */}
				<button
					type="submit"
					disabled={isPending || signingIn}
					onClick={(e) => {
						if (!termsAccepted) {
							// Don't fire a doomed server round-trip: shake the
							// terms box and stay put until it is checked.
							e.preventDefault();
							setTermsError(true);
							termsRef.current?.scrollIntoView({
								behavior: "smooth",
								block: "center",
							});
						}
					}}
					className={`btn-brand btn-shine w-full py-3.5 text-sm font-extrabold uppercase tracking-wider disabled:opacity-60 ${
						termsAccepted ? "" : "opacity-70 saturate-[0.85]"
					}`}
					style={{
						boxShadow: termsAccepted
							? undefined
							: "0 4px 14px -8px color-mix(in srgb, var(--color-primary) 50%, transparent)",
					}}
				>
					{isPending || signingIn ? (
						<span className="inline-flex items-center justify-center gap-2">
							<svg
								className="animate-spin h-4 w-4"
								viewBox="0 0 24 24"
								fill="none"
								role="img"
								aria-label="Loading"
							>
								<circle
									className="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									strokeWidth="4"
								/>
								<path
									className="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
								/>
							</svg>
							{signingIn ? t("redirecting") : t("creatingAccount")}
						</span>
					) : (
						t("createAccount")
					)}
				</button>

				<div
					className="border-t pt-4 text-center"
					style={{
						borderColor:
							"color-mix(in srgb, var(--color-text-muted) 14%, transparent)",
					}}
				>
					<Link
						href="/login"
						className="inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-xs font-extrabold transition-all duration-200 hover:-translate-y-0.5"
						style={{
							color: "var(--color-primary)",
							background:
								"color-mix(in srgb, var(--color-primary) 8%, transparent)",
							borderColor:
								"color-mix(in srgb, var(--color-primary) 35%, transparent)",
						}}
					>
						<UserRound aria-hidden="true" className="h-3.5 w-3.5" />
						{t("alreadyHaveAccount")}
					</Link>
				</div>
			</form>
		</div>
	);
}
