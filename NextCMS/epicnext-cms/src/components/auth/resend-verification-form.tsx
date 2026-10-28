"use client";

import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import {
	type ResendVerificationState,
	resendVerification,
} from "@/actions/verify";
import {
	type CaptchaPublicConfig,
	CaptchaWidget,
} from "@/components/auth/captcha-widget";

const INITIAL_STATE: ResendVerificationState = { ok: false, error: null };

/**
 * Lets a visitor whose verification token expired or was mangled request a
 * fresh mail straight from the invalid card of /verify. The server answers
 * identically for unknown addresses, so no registered address can be probed;
 * the live feedback is limited to "we tried" vs "throttled" / "captcha".
 */
export function ResendVerificationForm({
	captcha = { provider: "none" },
	nonce,
}: {
	captcha?: CaptchaPublicConfig;
	nonce?: string;
} = {}) {
	const t = useTranslations("pages.verify");
	const fieldId = useId();
	const [state, formAction, isPending] = useActionState(
		resendVerification,
		INITIAL_STATE,
	);

	return (
		<form action={formAction} className="mt-1 w-full space-y-2 text-left">
			{state.ok ? (
				<p
					role="status"
					className="auth-alert auth-alert--success m-0 animate-fade-in-up"
				>
					{t("resendSent")}
				</p>
			) : state.error ? (
				<p role="alert" className="auth-alert m-0 animate-fade-in-up">
					{state.error === "captcha"
						? t("resendCaptchaFailed")
						: t("resendFailed")}
				</p>
			) : null}

			<label htmlFor={fieldId} className="auth-label">
				{t("resendEmail")}
			</label>
			<div className="flex flex-col gap-2 sm:flex-row">
				<div className="relative flex-1">
					<Mail
						aria-hidden="true"
						className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
						style={{ color: "var(--color-text-muted)" }}
					/>
					<input
						id={fieldId}
						name="email"
						type="email"
						required
						autoComplete="email"
						placeholder={t("resendEmail")}
						className="auth-input has-icon"
					/>
				</div>
				<button
					type="submit"
					disabled={isPending}
					className="btn-brand btn-shine mb-0.5 shrink-0 px-5 py-3 text-sm font-extrabold uppercase tracking-wider disabled:opacity-60"
				>
					{isPending ? (
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
							{t("resendButton")}
						</span>
					) : (
						t("resendButton")
					)}
				</button>
			</div>

			<CaptchaWidget captcha={captcha} nonce={nonce} className="mt-1" />
		</form>
	);
}
