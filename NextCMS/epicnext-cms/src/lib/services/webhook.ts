import { eq } from "drizzle-orm";
import { env } from "@/env";
import { db, WebsiteSetting } from "@/lib/db";
import { logger } from "@/lib/logger";
import { logServerError } from "@/lib/server-log";

export type { WebhookAction } from "@/types/admin";

import type { WebhookAction } from "@/types/admin";

interface WebhookPayload {
	action: WebhookAction;
	actor: string;
	target: string;
	targetId?: number;
	details?: string;
}

const ACTION_COLORS: Record<WebhookAction, number> = {
	ban: 0xf87272,
	unban: 0x36d399,
	kick: 0xfbbd23,
	disconnect: 0xfbbd23,
	room_delete: 0xf87272,
	user_edit: 0x3abff8,
	user_create: 0x36d399,
	news_publish: 0x36d399,
	news_delete: 0xf87272,
	hotel_alert: 0xa78bfa,
	staff_alert: 0xa78bfa,
	ticket_create: 0x3abff8,
	event_create: 0x36d399,
	event_update: 0x3abff8,
	event_cancel: 0xf87272,
	poll_create: 0x36d399,
	poll_close: 0xa78bfa,
};

async function getSetting(
	cmsKey: string,
	envValue?: string,
): Promise<string | null> {
	if (envValue) return envValue;
	try {
		const [setting] = await db
			.select({ value: WebsiteSetting.value })
			.from(WebsiteSetting)
			.where(eq(WebsiteSetting.key, cmsKey))
			.limit(1);
		return setting?.value || null;
	} catch {
		return null;
	}
}

async function sendDiscord(payload: WebhookPayload): Promise<void> {
	const url = await getSetting("webhook_discord_url", env.DISCORD_WEBHOOK_URL);
	if (!url) return;

	const embed = {
		title: `[${payload.action.toUpperCase().replace("_", " ")}]`,
		color: ACTION_COLORS[payload.action] ?? 0x666666,
		fields: [
			{ name: "Staff", value: payload.actor, inline: true },
			{ name: "Target", value: payload.target, inline: true },
		],
		timestamp: new Date().toISOString(),
	};

	if (payload.details) {
		embed.fields.push({
			name: "Details",
			value: payload.details,
			inline: false,
		});
	}

	try {
		await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ embeds: [embed] }),
			signal: AbortSignal.timeout(5000),
		});
	} catch (err) {
		logger.error("[Webhook] Discord send failed", {
			action: payload.action,
			error: (err as Error).message,
		});
	}
}

async function sendTelegram(payload: WebhookPayload): Promise<void> {
	const token = await getSetting(
		"webhook_telegram_bot_token",
		env.TELEGRAM_BOT_TOKEN,
	);
	const chatId = await getSetting(
		"webhook_telegram_chat_id",
		env.TELEGRAM_CHAT_ID,
	);
	if (!token || !chatId) return;

	const text = [
		`<b>[${payload.action.toUpperCase().replace("_", " ")}]</b>`,
		`<b>Staff:</b> ${payload.actor}`,
		`<b>Target:</b> ${payload.target}`,
		payload.details ? `<b>Details:</b> ${payload.details}` : "",
	]
		.filter(Boolean)
		.join("\n");

	try {
		await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
			signal: AbortSignal.timeout(5000),
		});
	} catch (err) {
		logger.error("[Webhook] Telegram send failed", {
			action: payload.action,
			error: (err as Error).message,
		});
	}
}

/** Fire-and-forget notification to Discord + Telegram */
export function notify(payload: WebhookPayload): void {
	sendDiscord(payload).catch((error) =>
		logServerError("webhook.discord_notify_failed", error, {
			action: payload.action,
		}),
	);
	sendTelegram(payload).catch((error) =>
		logServerError("webhook.telegram_notify_failed", error, {
			action: payload.action,
		}),
	);
}
