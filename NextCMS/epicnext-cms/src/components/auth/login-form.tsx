"use client";

import { KeyRound, Lock, UserRound } from "lucide-react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { precheckLogin } from "@/actions/auth-precheck";
import { AuthAlert } from "@/components/auth/auth-alert";
import { AuthField } from "@/components/auth/auth-field";
import {
	type CaptchaPublicConfig,
	CaptchaWidget,
	readCaptchaToken,
} from "@/components/auth/captcha-widget";
import { PasswordToggle } from "@/components/auth/password-toggle";
import Link from "@/components/link";
import { signInWithTransientRetry } from "@/lib/auth/sign-in-retry";

export type LoginFormVariant =
	/** Full page: labelled fields, plus the register / forgot-password footer. */
	| "page"
	/** Homepage sidebar: visible labels, no footer, tighter spacing. */
	| "compact";

export interface LoginFormProps {
	captcha?: CaptchaPublicConfig;
	nonce?: string;
	variant?: LoginFormVariant;
	/** Where to land after a successful sign-in. */
	redirectTo?: string;
}

/**
 * The single sign-in form for both `/login` and the homepage sidebar. It runs a
 * cheap server-side precheck first so the visitor gets a specific reason
 * (bad password, unverified email, 2FA required, captcha) instead of NextAuth's
 * generic failure, then completes the credentials sign-in.
 */
export function LoginForm({
	captcha = { provider: "none" },
	nonce,
	variant = "page",
	redirectTo = "/me",
}: LoginFormProps = {}) {
	const t = useTranslations("pages.login");
	const fieldId = useId();
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [code, setCode] = useState("");
	const [needs2fa, setNeeds2fa] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [unverified, setUnverified] = useState(false);
	const [pending, setPending] = useState(false);
	const [locked, setLocked] = useState(false);
	const codeRef = useRef<HTMLInputElement>(null);

	// The 2FA field only exists after the pre-check asks for a code; move focus
	// there automatically so the visitor can keep typing without reaching for
	// the mouse (the lint rule rules out a bare `autoFocus`).
	useEffect(() => {
		if (needs2fa) codeRef.current?.focus();
	}, [needs2fa]);

	const showFooter = variant === "page";
	const compact = variant === "compact";
	const lockCredentials =
		needs2fa || locked ? "opacity-50 pointer-events-none" : "";

	async function onSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (locked) return;
		setError(null);
		setUnverified(false);
		setPending(true);
		try {
			if (!needs2fa) {
				const captchaToken = readCaptchaToken(e.currentTarget, captcha);
				const pre = await precheckLogin(username, password, captchaToken);
				if (pre === "invalid") {
					setError(t("errorInvalidCredentials"));
					return;
				}
				if (pre === "locked") {
					setLocked(true);
					setError(t("errorLocked"));
					return;
				}
				if (pre === "captcha") {
					setError(t("errorCaptcha"));
					return;
				}
				if (pre === "unverified") {
					setError(t("errorUnverified"));
					setUnverified(true);
					return;
				}
				if (pre === "twofactor") {
					setNeeds2fa(true);
					return;
				}
			}
			const res = await signInWithTransientRetry(() =>
				signIn("credentials", {
					username,
					password,
					code,
					redirect: false,
				}),
			);
			if (!res || res.error) {
				setError(
					needs2fa ? t("errorInvalid2fa") : t("errorInvalidCredentials"),
				);
				return;
			}
			window.location.href = redirectTo;
		} catch {
			setError(needs2fa ? t("errorInvalid2fa") : t("errorInvalidCredentials"));
		} finally {
			setPending(false);
		}
	}

	return (
		<>
			{needs2fa && (
				<p
					className={`animate-fade-in-up rounded-xl border px-3 py-2.5 text-sm font-semibold ${
						compact ? "mb-3" : "mb-4"
					}`}
					style={{
						color: "var(--color-text-readable)",
						background:
							"color-mix(in srgb, var(--color-primary) 10%, transparent)",
						borderColor:
							"color-mix(in srgb, var(--color-primary) 26%, transparent)",
					}}
				>
					{t("subtitle2fa")}
				</p>
			)}

			<form
				onSubmit={onSubmit}
				aria-label={t("signIn")}
				className={`relative flex flex-col ${compact ? "gap-3" : "gap-4"}`}
			>
				<AuthField
					id={`${fieldId}-username`}
					name="username"
					label={t("username")}
					icon={UserRound}
					value={username}
					onChange={setUsername}
					placeholder={t("usernamePlaceholder")}
					autoComplete="username"
					disabled={needs2fa || pending}
					required
					invalid={!!error}
					describedBy={error ? `${fieldId}-error` : undefined}
					className={lockCredentials}
				/>

				<AuthField
					id={`${fieldId}-password`}
					name="password"
					label={t("password")}
					icon={Lock}
					type={showPassword ? "text" : "password"}
					value={password}
					onChange={setPassword}
					placeholder={t("passwordPlaceholder")}
					autoComplete="current-password"
					disabled={needs2fa || pending}
					required
					invalid={!!error}
					describedBy={error ? `${fieldId}-error` : undefined}
					className={lockCredentials}
					trailing={
						<PasswordToggle
							show={showPassword}
							onToggle={() => setShowPassword((v) => !v)}
							labelShow={t("showPassword")}
							labelHide={t("hidePassword")}
						/>
					}
				/>

				{needs2fa ? (
					<AuthField
						id={`${fieldId}-2fa`}
						name="code"
						label={t("codePlaceholder")}
						icon={KeyRound}
						iconColor="var(--color-primary)"
						value={code}
						onChange={setCode}
						placeholder={t("codePlaceholder")}
						inputMode="numeric"
						autoComplete="one-time-code"
						disabled={pending}
						invalid={!!error}
						describedBy={error ? `${fieldId}-error` : undefined}
						className="animate-scale-in"
						inputRef={codeRef}
						inputStyle={{
							borderColor:
								"color-mix(in srgb, var(--color-primary) 45%, transparent)",
						}}
					/>
				) : (
					<CaptchaWidget captcha={captcha} nonce={nonce} />
				)}

				{error && <AuthAlert id={`${fieldId}-error`}>{error}</AuthAlert>}

				{unverified && (
					<p
						className="m-0 text-center text-xs"
						style={{ color: "var(--color-text-muted)" }}
					>
						<Link
							href="/verify"
							className="font-extrabold transition-colors hover:underline"
							style={{ color: "var(--color-primary)" }}
						>
							{t("verifyEmailCta")}
						</Link>
					</p>
				)}

				<button
					type="submit"
					disabled={pending || locked}
					className={`btn-brand btn-shine w-full cursor-pointer text-sm font-extrabold uppercase tracking-wider disabled:opacity-60 ${
						compact ? "py-3" : "py-3.5"
					}`}
				>
					{pending ? (
						<span className="inline-flex items-center justify-center gap-2">
							<svg
								className="h-4 w-4 animate-spin"
								viewBox="0 0 24 24"
								fill="none"
								role="img"
								aria-label={t("pleaseWait")}
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
							{t("pleaseWait")}
						</span>
					) : needs2fa ? (
						t("verify")
					) : (
						t("signIn")
					)}
				</button>
			</form>

			{showFooter && (
				<div
					className="mt-6 space-y-3 border-t pt-5"
					style={{
						borderColor:
							"color-mix(in srgb, var(--color-text-muted) 14%, transparent)",
					}}
				>
					<p
						className="text-center text-xs"
						style={{ color: "var(--color-text-muted)" }}
					>
						{t("noAccount")}{" "}
						<Link
							href="/register"
							className="font-extrabold transition-colors hover:underline"
							style={{ color: "var(--color-primary)" }}
						>
							{t("createOne")}
						</Link>
					</p>
					<Link
						href="/forgot"
						className="flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-xs font-extrabold transition-all duration-200 hover:-translate-y-0.5"
						style={{
							color: "var(--color-primary)",
							background:
								"color-mix(in srgb, var(--color-primary) 8%, transparent)",
							borderColor:
								"color-mix(in srgb, var(--color-primary) 35%, transparent)",
						}}
					>
						<KeyRound aria-hidden="true" className="h-3.5 w-3.5" />
						{t("forgotPassword")}
					</Link>
				</div>
			)}
		</>
	);
}
