"use client";

import Script from "next/script";

export type CaptchaPublicConfig = {
	provider: string;
	siteKey?: string;
	field?: string;
};

/** Renders Turnstile / reCAPTCHA widget + script when a provider is configured. */
export function CaptchaWidget({
	captcha,
	nonce,
	className,
}: {
	captcha: CaptchaPublicConfig;
	nonce?: string;
	className?: string;
}) {
	const showCaptcha = captcha.provider !== "none" && !!captcha.siteKey;
	if (!showCaptcha) return null;

	return (
		<div className={className}>
			{captcha.provider === "turnstile" ? (
				<>
					<Script
						src="https://challenges.cloudflare.com/turnstile/v0/api.js"
						async
						defer
						nonce={nonce}
					/>
					<div className="cf-turnstile" data-sitekey={captcha.siteKey} />
				</>
			) : null}
			{captcha.provider === "recaptcha" ? (
				<>
					<Script
						src="https://www.google.com/recaptcha/api.js"
						async
						defer
						nonce={nonce}
					/>
					<div className="g-recaptcha" data-sitekey={captcha.siteKey} />
				</>
			) : null}
		</div>
	);
}

/** Read the provider token from a form (widget injects a hidden input). */
export function readCaptchaToken(
	form: HTMLFormElement,
	captcha: CaptchaPublicConfig,
): string {
	if (captcha.provider === "none" || !captcha.field) return "";
	const fd = new FormData(form);
	return String(fd.get(captcha.field) ?? "").normalize("NFC");
}
