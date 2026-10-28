import { env } from "@/env";
import { siteSettings } from "@/lib/services/site-settings";

/**
 * Server-side CAPTCHA verification. The provider is driven by website_settings
 * (staff pick it in housekeeping) with an ENV FALLBACK so a deploy can enable
 * Turnstile without touching the DB: unset DB keys fall back to
 * CAPTCHA_PROVIDER / TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY. An explicit DB
 * value — including "none" — always wins over env. Supports Cloudflare
 * Turnstile, Google reCAPTCHA, and hCaptcha (mutually exclusive).
 *
 * Behaviour:
 *   - provider "none" (or unset everywhere) → fail-open (allow)
 *   - provider configured but site key / secret missing, token absent, provider
 *     API error, or network failure → fail-closed (deny)
 *
 * Settings keys (DB) / env fallbacks:
 *   captcha_provider          = "turnstile" | "recaptcha" | "hcaptcha" | "none"
 *   CAPTCHA_PROVIDER          (env, used when the DB key is unset)
 *   turnstile_site_key        / TURNSTILE_SITE_KEY
 *   turnstile_secret          / TURNSTILE_SECRET_KEY
 *   recaptcha_site_key        (DB only)
 *   recaptcha_secret          (DB only)
 *   hcaptcha_site_key         (DB only)
 *   hcaptcha_secret           (DB only)
 */
export interface CaptchaConfig {
	provider: "turnstile" | "recaptcha" | "hcaptcha" | "none";
	siteKey: string;
	/** Form field the widget writes the token into. */
	field: string;
}

const TURNSTILE_URL =
	"https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RECAPTCHA_URL = "https://www.google.com/recaptcha/api/siteverify";
const HCAPTCHA_URL = "https://hcaptcha.com/siteverify";

/** DB first (staff can override live), env fallback for unconfigured deploys. */
async function settingOrEnv(
	settingKey: string,
	settingDefault: string,
	envValue: string | undefined,
): Promise<string> {
	const dbValue = (await siteSettings.get(settingKey, settingDefault)) ?? "";
	if (dbValue.trim() !== "") return dbValue.trim();
	return envValue?.trim() || "";
}

/** Public config the register/login pages need to render the widget (no secrets). */
export async function captchaConfig(): Promise<CaptchaConfig> {
	// Empty DB fallback distinguishes "unset" from an explicit "none": only an
	// explicit DB value short-circuits the env fallback.
	const provider = (
		await settingOrEnv("captcha_provider", "", env.CAPTCHA_PROVIDER)
	).toLowerCase();
	if (provider === "turnstile") {
		return {
			provider: "turnstile",
			siteKey: await settingOrEnv(
				"turnstile_site_key",
				"",
				env.TURNSTILE_SITE_KEY,
			),
			field: "cf-turnstile-response",
		};
	}
	if (provider === "recaptcha") {
		return {
			provider: "recaptcha",
			siteKey: (await siteSettings.get("recaptcha_site_key", "")) ?? "",
			field: "g-recaptcha-response",
		};
	}
	if (provider === "hcaptcha") {
		return {
			provider: "hcaptcha",
			siteKey: (await siteSettings.get("hcaptcha_site_key", "")) ?? "",
			field: "hcaptcha-response",
		};
	}
	return { provider: "none", siteKey: "", field: "" };
}

/** Verify a submitted token. Fail-closed when a provider is configured. */
export async function verifyCaptcha(
	token: string | null,
	remoteIp?: string,
): Promise<boolean> {
	const cfg = await captchaConfig();
	if (cfg.provider === "none") return true;

	if (!cfg.siteKey) return false;

	const secret =
		cfg.provider === "turnstile"
			? await settingOrEnv("turnstile_secret", "", env.TURNSTILE_SECRET_KEY)
			: cfg.provider === "recaptcha"
				? ((await siteSettings.get("recaptcha_secret", "")) ?? "")
				: ((await siteSettings.get("hcaptcha_secret", "")) ?? "");
	if (!secret) return false;
	if (!token) return false;

	const url: string =
		cfg.provider === "turnstile"
			? TURNSTILE_URL
			: cfg.provider === "recaptcha"
				? RECAPTCHA_URL
				: HCAPTCHA_URL;
	const body = new URLSearchParams({ secret, response: token });
	if (remoteIp) body.set("remoteip", remoteIp);

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 5000);
		const res = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body,
			signal: controller.signal,
			cache: "no-store",
		});
		clearTimeout(timer);
		if (!res.ok) return false;
		const data = (await res.json()) as { success?: boolean };
		return data?.success === true;
	} catch {
		// Network/timeout/misconfig — fail-closed so captcha can't be bypassed.
		return false;
	}
}
