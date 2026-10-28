import { z } from "zod";

// Minimal validated env for the foundation. When the Next.js app is added this
// will move to @t3-oss/env-nextjs (the habbo-next pattern), but the data layer
// only needs the DB connection + a couple of values today.
const schema = z
	.object({
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
		HOUSEKEEPING_NEXT_PREVIEW_ENABLED: z
			.string()
			.optional()
			.transform((value) => value === "true" || value === "1"),
		DATABASE_URL: z.string().url(),
		DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),
		DATABASE_IDLE_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(300_000),
		DATABASE_CONNECT_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(10_000),
		HOTEL_NAME: z
			.string()
			.min(
				1,
				"HOTEL_NAME is not set — the site has not been configured/built yet.",
			),
		APP_URL: z.string().url().default("http://localhost:3000"),
		NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
		// Public imager URL — overrides the default /imaging relative path.
		NEXT_PUBLIC_IMAGER_URL: z.string().optional(),
		// Upstream avatar imager proxy (defaults to Habbo's public imager).
		IMAGING_UPSTREAM_URL: z.string().optional(),
		// Resend API key (preferred — simpler HTTP API, always works).
		RESEND_API_KEY: z.string().optional(),
		// SMTP (password reset / notifications). Email features no-op if unset.
		SMTP_HOST: z.string().optional(),
		SMTP_PORT: z.coerce.number().int().positive().optional(),
		SMTP_SECURE: z
			.string()
			.optional()
			.transform((v) => v === "true" || v === "1"),
		SMTP_USER: z.string().optional(),
		SMTP_PASSWORD: z.string().optional(),
		SMTP_FROM: z.string().optional(),
		// RCON link to the Arcturus emulator (raw-JSON TCP protocol).
		RCON_HOST: z.string().default("127.0.0.1"),
		RCON_PORT: z.coerce.number().int().positive().default(3001),
		RCON_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
		RCON_MAX_RETRIES: z.coerce.number().int().positive().default(3),
		// Emulator transport selection. "rcon" uses the raw-JSON TCP protocol
		// above; "api" uses an HTTP endpoint that accepts the same
		// `{"key":...,"data":...}` payload (for emulators without RCON).
		EMULATOR_MODE: z.enum(["rcon", "api"]).default("rcon"),
		// HTTP endpoint used when EMULATOR_MODE=api. Required in that mode.
		EMULATOR_API_URL: z.string().url().optional(),
		// Optional bearer/key auth for the API transport. When set, it is sent
		// as `${EMULATOR_API_KEY_HEADER}: ${EMULATOR_API_KEY}` (default header
		// "Authorization").
		EMULATOR_API_KEY: z.string().optional(),
		EMULATOR_API_KEY_HEADER: z.string().default("Authorization"),
		// NextAuth v5 reads AUTH_SECRET itself; declared here for documentation/typing.
		AUTH_SECRET: z.string().min(1).optional(),
		// Laravel APP_KEY (base64:...) — needed to read existing 2FA secrets.
		APP_KEY: z.string().optional(),

		// bcrypt cost factor used for new password hashes.
		BCRYPT_COST: z.coerce.number().int().min(4).max(31).default(12),
		// Password-length policy for every new password (register, password reset
		// and staff-created accounts). The minimum may be set between 5 and 30
		// characters, the maximum between 30 and 128, so min always fits under max.
		PASSWORD_MIN_LENGTH: z.coerce.number().int().min(5).max(30).default(12),
		PASSWORD_MAX_LENGTH: z.coerce.number().int().min(30).max(128).default(128),
		// Filesystem dir the badge uploader writes <code>.gif into (the emulator's
		// badge image folder, e.g. .../assets/c_images/album1584). Upload is disabled
		// when unset.
		BADGE_UPLOAD_DIR: z.string().optional(),
		// Extension local furniture bundles are written with and the client
		// requests: ".hab" (default) or ".nitro". Accepts the bare form too.
		FURNI_BUNDLE_EXT: z.string().optional(),
		// Emulator JAR backup job (jobs-worker, host-side); no-op unless both set.
		EMULATOR_JAR_PATH: z.string().optional(),
		EMULATOR_BACKUP_DIR: z.string().optional(),
		EMULATOR_BACKUP_KEEP: z.coerce.number().int().positive().optional(),
		// Optional mysqldump backup (jobs-worker); requires mysqldump on PATH.
		DB_BACKUP_DIR: z.string().optional(),
		DB_BACKUP_KEEP: z.coerce.number().int().positive().optional(),
		// Minutes between repeat health-fail Discord/email alerts (jobs-worker).
		HEALTH_ALERT_COOLDOWN_MIN: z.coerce.number().int().positive().optional(),
		// Optional AI content moderation (comments / guestbook).
		OPENAI_API_KEY: z.string().optional(),
		// Optional alerting (jobs worker / alert service).
		DISCORD_WEBHOOK_URL: z.string().url().optional(),
		TELEGRAM_BOT_TOKEN: z.string().optional(),
		TELEGRAM_CHAT_ID: z.string().optional(),
		ALERT_EMAIL: z.string().optional(),
		// Optional PayPal top-up.
		PAYPAL_CLIENT_ID: z.string().optional(),
		PAYPAL_SECRET: z.string().optional(),
		PAYPAL_API: z.string().url().optional(),
		PAYPAL_CURRENCY: z.string().default("USD"),
		PAYPAL_CREDITS_PER_USD: z.coerce.number().positive().default(100),
		// Redis — strongly recommended in production (required for multi-instance).
		// Without it, rate limits / shared caches are in-process only.
		REDIS_URL: z.string().optional(),
		// ── Cache TTL tuning (seconds; see src/lib/perf-ttls.ts) ──────────────
		// Defaults match the previous hard-coded values; set only to tune.
		CMS_HOME_PAYLOAD_TTL_SEC: z.coerce.number().int().positive().optional(),
		CMS_NEWS_LIST_TTL_SEC: z.coerce.number().int().positive().optional(),
		CMS_NEWS_ARCHIVE_TTL_SEC: z.coerce.number().int().positive().optional(),
		CMS_SEARCH_TTL_SEC: z.coerce.number().int().positive().optional(),
		CMS_ONLINE_COUNT_TTL_SEC: z.coerce.number().int().positive().optional(),
		CMS_COUNTERS_TTL_SEC: z.coerce.number().int().positive().optional(),
		CMS_SITE_SETTINGS_TTL_SEC: z.coerce.number().int().positive().optional(),
		CMS_SITE_SETTINGS_MEMORY_TTL_SEC: z.coerce
			.number()
			.int()
			.positive()
			.optional(),
		// Boot-time cache warm-up (priming hot keys after each deploy). Set to
		// "false"/"0" to skip — useful on hosts where the boot DB burst is
		// undesirable (e.g. tiny containers right after a restore).
		CMS_WARMUP_ENABLED: z
			.string()
			.optional()
			.transform((value) => value !== "false" && value !== "0"),
		// App-layer anti-DDoS gate (proxy rate limiter). On by default in
		// production; set to "false" or "0" to disable without removing it.
		ANTI_DDOS_ENABLED: z
			.string()
			.optional()
			.transform((value) => value !== "false" && value !== "0"),
		// Anti-DDoS thresholds. These are the YAML-file boot defaults; the admin
		// panel can override them at runtime (Redis `antiddos:config`).
		ANTI_DDOS_PAGES_LIMIT: z.coerce.number().int().positive().default(300),
		ANTI_DDOS_PAGES_WINDOW_SEC: z.coerce.number().int().positive().default(60),
		ANTI_DDOS_API_LIMIT: z.coerce.number().int().positive().default(600),
		ANTI_DDOS_API_WINDOW_SEC: z.coerce.number().int().positive().default(60),
		ANTI_DDOS_AUTH_LIMIT: z.coerce.number().int().positive().default(20),
		ANTI_DDOS_AUTH_WINDOW_SEC: z.coerce.number().int().positive().default(60),
		ANTI_DDOS_GLOBAL_LIMIT: z.coerce.number().int().positive().default(18_000),
		ANTI_DDOS_GLOBAL_WINDOW_SEC: z.coerce.number().int().positive().default(60),
		ANTI_DDOS_VIOLATION_WINDOW_SEC: z.coerce
			.number()
			.int()
			.positive()
			.default(600),
		ANTI_DDOS_MAX_VIOLATIONS: z.coerce.number().int().positive().default(10),
		// Escalation tiers as "minViolations:ttlSeconds,minViolations:ttlSeconds".
		ANTI_DDOS_BLOCK_TIERS: z.string().optional(),
		ANTI_DDOS_GLOBAL_HALT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(10_000),
		// Logging level.
		LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
		APP_VERSION: z.string().optional(),
		// Cloudflare API — optional. When the API token + zone id are set, the
		// anti-DDoS gate can automatically mirror escalated IP blocks to the
		// zone's IP Access Rules so attackers are dropped at the edge. The token
		// lives in env only and is never persisted into Redis-visible config.
		CLOUDFLARE_API_BASE_URL: z
			.string()
			.url()
			.default("https://api.cloudflare.com/client/v4"),
		CLOUDFLARE_API_TOKEN: z.string().optional(),
		CLOUDFLARE_ZONE_ID: z.string().optional(),
		// Boot default for the runtime "auto-create Cloudflare blocks" toggle
		// (overridable via the admin panel / antiddos:config).
		CLOUDFLARE_AUTO_BLOCK_ENABLED: z
			.string()
			.optional()
			.transform((value) => value !== "false" && value !== "0"),
		// ── CAPTCHA (Turnstile) — env fallback for the DB-backed settings ─────
		// The admin panel (housekeeping → settings) wins when it has values; these
		// let a deploy enable Turnstile without touching the DB. An explicit DB
		// value — including "none" — always overrides the env fallback.
		CAPTCHA_PROVIDER: z.preprocess(
			(value) => (value === "" ? undefined : value),
			z.enum(["none", "turnstile", "recaptcha", "hcaptcha"]).optional(),
		),
		// Public site key (rendered in the widget via server → client props).
		TURNSTILE_SITE_KEY: z.string().optional(),
		// Server-only secret used against Cloudflare's siteverify endpoint.
		// Never NEXT_PUBLIC_: verification would become client-trusting.
		TURNSTILE_SECRET_KEY: z.string().optional(),
	})
	.superRefine((data, ctx) => {
		if (data.NODE_ENV !== "production") return;
		// AUTH_SECRET
		if (!data.AUTH_SECRET || data.AUTH_SECRET.length < 32) {
			ctx.addIssue({
				code: "custom",
				message:
					"AUTH_SECRET (>=32 characters) is required when NODE_ENV=production",
				path: ["AUTH_SECRET"],
			});
		}
		// Mail-enabled deployments must know their own public origin, or every
		// verification / password-reset link points at localhost.
		const mailEnabled = Boolean(
			data.SMTP_HOST || data.RESEND_API_KEY || data.SMTP_USER,
		);
		if (
			mailEnabled &&
			!process.env.APP_URL &&
			!process.env.NEXT_PUBLIC_APP_URL
		) {
			ctx.addIssue({
				code: "custom",
				message:
					"APP_URL is required when mail is configured — password-reset and email-verification links would otherwise point at localhost",
				path: ["APP_URL"],
			});
		}
		// The two must not disagree: CSRF origin checks and generated links use
		// different ones depending on the code path.
		if (
			process.env.APP_URL &&
			process.env.NEXT_PUBLIC_APP_URL &&
			process.env.APP_URL !== process.env.NEXT_PUBLIC_APP_URL
		) {
			ctx.addIssue({
				code: "custom",
				message:
					"APP_URL and NEXT_PUBLIC_APP_URL must match — links and origin checks disagree",
				path: ["NEXT_PUBLIC_APP_URL"],
			});
		}
		// PayPal credentials must be paired.
		if (data.PAYPAL_CLIENT_ID && !data.PAYPAL_SECRET) {
			ctx.addIssue({
				code: "custom",
				message: "PAYPAL_SECRET is required when PAYPAL_CLIENT_ID is set",
				path: ["PAYPAL_SECRET"],
			});
		}
		if (!data.PAYPAL_CLIENT_ID && data.PAYPAL_SECRET) {
			ctx.addIssue({
				code: "custom",
				message: "PAYPAL_CLIENT_ID is required when PAYPAL_SECRET is set",
				path: ["PAYPAL_CLIENT_ID"],
			});
		}
	});

type Env = z.infer<typeof schema>;

// SKIP_ENV_VALIDATION is for tooling only (vitest). Production deploy must NOT
// set this — builds should validate AUTH_SECRET, DATABASE_URL, etc.
export const env: Env = process.env.SKIP_ENV_VALIDATION
	? (process.env as unknown as Env)
	: schema.parse(process.env);
