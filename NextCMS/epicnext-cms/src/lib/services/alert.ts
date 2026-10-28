import { env } from "@/env";
import { AlertLogs, db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/services/email";
import { diskLevel, formatBytes } from "./disk-usage";

// === Alert service (AtomCMS → Next.js) ===========================================
//
// A pure, dependency-free server module for raising operational alerts. A single
// sendAlert() call (a) persists a row in alert_logs, (b) pushes a Discord embed
// to DISCORD_WEBHOOK_URL when set, and (c) optionally emails staff via sendMail()
// when ALERT_EMAIL is set.
//
// Every external side-effect is wrapped in try/catch so a failing webhook, dead
// SMTP host, or unreachable DB never throws into the caller (which is usually a
// background path: emulator health checks, DDoS detection, etc.). Uses the global
// fetch (Node 18+/Next 16) — no extra packages.
//

export type AlertSeverity =
	| "info"
	| "notice"
	| "warning"
	| "error"
	| "critical";

export interface SendAlertInput {
	/** Machine-readable category, e.g. "emulator", "security", "ddos". */
	type: string;
	/** Free-text severity; drives Discord embed colour + email subject prefix. */
	severity: AlertSeverity | string;
	/** Human-readable message body. */
	message: string;
	/** Optional structured payload stored verbatim in alert_logs.context (JSON). */
	context?: Record<string, unknown>;
}

export interface SendAlertResult {
	logged: boolean;
	sentViaDiscord: boolean;
	sentViaEmail: boolean;
}

// Discord embed sidebar colours (decimal RGB) keyed by normalised severity.
const DISCORD_COLORS: Record<string, number> = {
	critical: 0xc0392b,
	error: 0xe74c3c,
	danger: 0xe74c3c,
	warning: 0xf39c12,
	warn: 0xf39c12,
	success: 0x2ecc71,
	info: 0x3498db,
	notice: 0x9b59b6,
};

function severityColor(severity: string): number {
	return DISCORD_COLORS[severity.toLowerCase()] ?? 0x95a5a6;
}

function discordWebhookUrl(): string | undefined {
	return env.DISCORD_WEBHOOK_URL || undefined;
}

function alertEmail(): string | undefined {
	return env.ALERT_EMAIL || undefined;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Post a Discord embed to DISCORD_WEBHOOK_URL. Returns false (without throwing)
 * when the webhook is unset, the request fails, or Discord returns non-2xx.
 */
async function postDiscord(input: SendAlertInput): Promise<boolean> {
	const url = discordWebhookUrl();
	if (!url) return false;

	const fields = input.context
		? Object.entries(input.context)
				.slice(0, 10)
				.map(([name, value]) => ({
					name: String(name).slice(0, 256) || "​",
					value: String(value ?? "").slice(0, 1024) || "​",
					inline: true,
				}))
		: undefined;

	const body = {
		username: `${env.HOTEL_NAME} Alerts`,
		embeds: [
			{
				title: `[${String(input.severity).toUpperCase()}] ${input.type}`.slice(
					0,
					256,
				),
				description: input.message.slice(0, 4096),
				color: severityColor(input.severity),
				timestamp: new Date().toISOString(),
				...(fields?.length ? { fields } : {}),
				footer: { text: env.HOTEL_NAME },
			},
		],
	};

	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			logger.error("Discord webhook returned non-OK status", {
				module: "alert",
				status: res.status,
			});
			return false;
		}
		return true;
	} catch (e) {
		logger.error("Discord webhook failed", {
			module: "alert",
			error: (e as Error).message,
		});
		return false;
	}
}

/**
 * Email the alert to ALERT_EMAIL via sendMail(). Returns false (without throwing)
 * when ALERT_EMAIL is unset, SMTP isn't configured, or sending fails. sendMail
 * already swallows its own errors, but we guard defensively anyway.
 */
async function emailStaff(input: SendAlertInput): Promise<boolean> {
	const to = alertEmail();
	if (!to) return false;

	const subject = `[${env.HOTEL_NAME}] ${String(input.severity).toUpperCase()} · ${input.type}`;
	const contextRows = input.context
		? Object.entries(input.context)
				.map(
					([k, v]) =>
						`<tr><td style="padding:4px 10px;font-weight:600">${escapeHtml(String(k))}</td>` +
						`<td style="padding:4px 10px">${escapeHtml(String(v ?? ""))}</td></tr>`,
				)
				.join("")
		: "";
	const html =
		`<h2 style="margin:0 0 8px">${escapeHtml(input.type)} — ${escapeHtml(String(input.severity))}</h2>` +
		`<p style="margin:0 0 12px">${escapeHtml(input.message)}</p>` +
		(contextRows
			? `<table style="border-collapse:collapse;font-size:13px">${contextRows}</table>`
			: "") +
		`<p style="margin-top:16px;color:#888;font-size:12px">` +
		`Sent by ${escapeHtml(env.HOTEL_NAME)} · <a href="${env.APP_URL}/admin/alerts">view alerts</a></p>`;

	try {
		return await sendMail(to, subject, html);
	} catch (e) {
		logger.error("Staff email failed", {
			module: "alert",
			error: (e as Error).message,
		});
		return false;
	}
}

/**
 * Raise an operational alert: persist to alert_logs and fan out to Discord +
 * email. Never throws — each side-effect is isolated; a failure in one channel
 * does not block the others. The returned result reports which channels
 * succeeded (also reflected in the alert_logs row's sent_via_* flags).
 */
export async function sendAlert(
	input: SendAlertInput,
): Promise<SendAlertResult> {
	// Fan out Discord + email first so we can record their outcome on the row.
	const [sentViaDiscord, sentViaEmail] = await Promise.all([
		postDiscord(input),
		emailStaff(input),
	]);

	let logged = false;
	try {
		const now = new Date();
		await db.insert(AlertLogs).values({
			type: input.type.slice(0, 255),
			severity: String(input.severity).slice(0, 255),
			message: input.message,
			context: input.context ? JSON.stringify(input.context) : null,
			sentViaDiscord,
			sentViaEmail,
			isRead: false,
			createdAt: now,
			updatedAt: now,
		});
		logged = true;
	} catch (e) {
		// DB unreachable / schema drift: keep the alert best-effort. We already
		// notified Discord/email above, so the alert isn't lost.
		logger.error("Failed to persist alert_logs row", {
			module: "alert",
			error: (e as Error).message,
		});
	}

	return { logged, sentViaDiscord, sentViaEmail };
}

// === Helpers =====================================================================

/**
 * Raise a CRITICAL alert that the Arcturus emulator appears to be offline
 * (e.g. raised by a health-check cron when the RCON socket can't connect).
 */
export function emulatorOffline(detail?: string): Promise<SendAlertResult> {
	return sendAlert({
		type: "emulator",
		severity: "critical",
		message: detail
			? `Emulator appears offline: ${detail}`
			: "Emulator appears offline — RCON connection could not be established.",
		context: {
			rconHost: env.RCON_HOST,
			rconPort: env.RCON_PORT,
			...(detail ? { detail } : {}),
		},
	});
}

/**
 * Raise an ERROR alert when ops health is degraded (DB / Redis / emulator).
 */
export function healthDegraded(parts: {
	database: boolean;
	redis: boolean | null;
	emulator: boolean;
}): Promise<SendAlertResult> {
	const failed: string[] = [];
	if (!parts.database) failed.push("database");
	if (parts.redis === false) failed.push("redis");
	if (!parts.emulator) failed.push("emulator");
	return sendAlert({
		type: "health",
		severity: parts.database ? "error" : "critical",
		message:
			failed.length > 0
				? `Ops health degraded: ${failed.join(", ")} unavailable.`
				: "Ops health degraded.",
		context: {
			database: parts.database,
			redis: parts.redis,
			emulator: parts.emulator,
		},
	});
}

/**
 * Raise a WARNING alert that a possible DDoS / abusive request pattern was
 * detected from a single IP (count = requests seen in the sampling window).
 */
export function ddosDetected(
	ip: string,
	count: number,
): Promise<SendAlertResult> {
	return sendAlert({
		type: "ddos",
		severity: count >= 1000 ? "critical" : "warning",
		message: `Possible DDoS detected from ${ip} — ${count} requests in window.`,
		context: { ip, count },
	});
}

/**
 * Raise a WARNING/ERROR/CRITICAL alert when a filesystem crosses a fill
 * threshold (see DISK_THRESHOLDS in disk-usage.ts): 85% warning, 90% error,
 * 95% critical. Includes the offending mount and a pointer to the Docker prune.
 */
export function diskPressure(usage: {
	filesystem: string;
	mount: string;
	totalBytes: number;
	usedBytes: number;
	availableBytes: number;
	percent: number;
}): Promise<SendAlertResult> {
	const level = diskLevel(usage.percent);
	const severity: AlertSeverity =
		level >= 3 ? "critical" : level === 2 ? "error" : "warning";
	return sendAlert({
		type: "disk",
		severity,
		message:
			`Disk ${level >= 3 ? "CRITICAL" : level === 2 ? "degraded" : "high"}: ` +
			`${usage.mount} is ${usage.percent}% full ` +
			`(${formatBytes(usage.usedBytes)} of ${formatBytes(usage.totalBytes)} used).`,
		context: {
			mount: usage.mount,
			filesystem: usage.filesystem,
			percentUsed: usage.percent,
			used: formatBytes(usage.usedBytes),
			total: formatBytes(usage.totalBytes),
			available: formatBytes(usage.availableBytes),
			hint: "Docker cache reclaim auto-fired with this alert; if the disk is still filling, the growth is outside Docker (check Gamedata/uploads/storage).",
		},
	});
}
