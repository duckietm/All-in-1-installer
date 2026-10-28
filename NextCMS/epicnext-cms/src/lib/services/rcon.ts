import net from "node:net";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { CurrencyType } from "@/lib/services/currency";

export interface RconPayload {
	key: string;
	data: Record<string, unknown> | null;
}

export type RconTransport = (payload: RconPayload) => Promise<boolean>;

/**
 * TCP transport faithful to AtomCMS's RconService: writes the raw JSON
 * `{"key":...,"data":...}` to rcon_ip:rcon_port with no terminator, fire-and-
 * forget. The PHP original silently drops on a dead socket; we add a bounded
 * connect timeout + exponential-backoff retry so delivery is best-effort.
 */
export function tcpTransport(opts: {
	host: string;
	port: number;
	timeoutMs: number;
	maxRetries: number;
}): RconTransport {
	const sendOnce = (payload: RconPayload): Promise<boolean> =>
		new Promise((resolve) => {
			const socket = new net.Socket();
			const json = JSON.stringify(payload);
			let settled = false;
			const finish = (ok: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				socket.destroy();
				resolve(ok);
			};
			const timer = setTimeout(() => finish(false), opts.timeoutMs);
			socket.once("error", () => finish(false));
			socket.connect(opts.port, opts.host, () => {
				socket.write(json, () => finish(true));
			});
		});

	return async (payload) => {
		for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
			if (await sendOnce(payload)) return true;
			if (attempt < opts.maxRetries - 1) {
				await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
			}
		}
		logger.error("RCON delivery failed after retries", {
			module: "rcon",
			key: payload.key,
		});
		return false;
	};
}

/**
 * Typed RCON commands. Payload shapes mirror AtomCMS's RconService EXACTLY
 * (e.g. sendgift uses `itemid`, disconnect carries `username`, no-data commands
 * send `data: null`, givepoints `type` is the numeric CurrencyType value).
 */
export class RconClient {
	constructor(private readonly transport: RconTransport) {}

	send(
		key: string,
		data: Record<string, unknown> | null = null,
	): Promise<boolean> {
		return this.transport({ key, data });
	}

	giveCredits(userId: number, credits: number) {
		return this.send("givecredits", { user_id: userId, credits });
	}
	givePoints(userId: number, amount: number, type: CurrencyType) {
		return this.send("givepoints", { user_id: userId, points: amount, type });
	}
	giveDuckets(userId: number, amount: number) {
		return this.givePoints(userId, amount, CurrencyType.Duckets);
	}
	giveDiamonds(userId: number, amount: number) {
		return this.givePoints(userId, amount, CurrencyType.Diamonds);
	}
	givePointsGotw(userId: number, amount: number) {
		return this.givePoints(userId, amount, CurrencyType.Points);
	}
	giveBadge(userId: number, badge: string) {
		return this.send("givebadge", { user_id: userId, badge });
	}
	setMotto(userId: number, motto: string) {
		return this.send("setmotto", { user_id: userId, motto });
	}
	setRank(userId: number, rank: number) {
		return this.send("setrank", { user_id: userId, rank });
	}
	sendGift(userId: number, itemId: number, message = "Here is a gift.") {
		return this.send("sendgift", { user_id: userId, itemid: itemId, message });
	}
	disconnectUser(userId: number, username = "") {
		return this.send("disconnect", { user_id: userId, username });
	}
	alertUser(userId: number, message: string) {
		return this.send("alertuser", { user_id: userId, message });
	}
	forwardUser(userId: number, roomId: number) {
		return this.send("forwarduser", { user_id: userId, room_id: roomId });
	}
	kickAll(roomId: number) {
		return this.send("kickall", { room_id: roomId });
	}
	hotelAlert(message: string) {
		return this.send("hotelalert", { message });
	}
	staffAlert(message: string) {
		return this.send("staffalert", { message });
	}
	executeCommand(userId: number, command: string) {
		return this.send("executecommand", { user_id: userId, command });
	}
	updateWordFilter() {
		return this.send("updatewordfilter");
	}
	updateCatalog() {
		return this.send("updatecatalog");
	}
	updateItems() {
		return this.send("updateitems");
	}
	updateConfig() {
		return this.send("updateconfig");
	}
	removeBadge(userId: number, badge: string) {
		return this.send("removebadge", { user_id: userId, badge });
	}
	muteUser(userId: number, duration: number) {
		return this.send("muteuser", { user_id: userId, duration });
	}
	unmuteUser(userId: number) {
		return this.send("unmuteuser", { user_id: userId });
	}
	/**
	 * Best-effort live trade lock sync. Polaris/Arcturus forks may expose
	 * `settradelock`; unknown keys are ignored by the emulator. Prefer updating
	 * `users_settings.can_trade` in DB and disconnecting online users.
	 */
	setTradeLock(userId: number, locked: boolean) {
		return this.send("settradelock", {
			user_id: userId,
			enabled: locked ? 0 : 1,
		});
	}
}

/**
 * HTTP transport for emulators that expose an API instead of RCON's raw-JSON
 * TCP protocol. It POSTs the exact same `{"key":...,"data":...}` payload the
 * TCP transport writes, so the RconClient command shapes stay identical.
 *
 * Mirrors the TCP transport's best-effort semantics: a 2xx response is treated
 * as delivered (`true`); any non-2xx, network error, or timeout is logged and
 * treated as not delivered (`false`).
 */
export function httpTransport(opts: {
	url: string;
	timeoutMs: number;
	apiKey?: string;
	apiKeyHeader?: string;
	maxRetries: number;
}): RconTransport {
	const sendOnce = (payload: RconPayload): Promise<boolean> =>
		new Promise((resolve) => {
			const body = JSON.stringify(payload);
			const headers: Record<string, string> = {
				"content-type": "application/json",
			};
			if (opts.apiKey) {
				const header = opts.apiKeyHeader ?? "Authorization";
				// Accept either a raw token or a full scheme (e.g. "Bearer xyz").
				headers[header] = /\s/.test(opts.apiKey)
					? opts.apiKey
					: `Bearer ${opts.apiKey}`;
			}
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
			fetch(opts.url, {
				method: "POST",
				headers,
				body,
				signal: controller.signal,
			})
				.then((res) => {
					clearTimeout(timer);
					resolve(res.ok);
				})
				.catch(() => {
					clearTimeout(timer);
					resolve(false);
				});
		});

	return async (payload) => {
		for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
			if (await sendOnce(payload)) return true;
			if (attempt < opts.maxRetries - 1) {
				await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
			}
		}
		logger.error("Emulator API delivery failed after retries", {
			module: "emulator-api",
			key: payload.key,
			url: opts.url,
		});
		return false;
	};
}

/**
 * Returns the configured emulator transport based on `EMULATOR_MODE`:
 * - "rcon" (default): raw-JSON TCP transport.
 * - "api": HTTP transport posting the RCON payload to `EMULATOR_API_URL`.
 *
 * Throws at construction time when api mode is selected without a URL so the
 * misconfiguration surfaces immediately instead of on first command.
 */
export function createEmulatorTransport(): RconTransport {
	if (env.EMULATOR_MODE === "api") {
		if (!env.EMULATOR_API_URL) {
			throw new Error("EMULATOR_MODE=api requires EMULATOR_API_URL to be set");
		}
		return httpTransport({
			url: env.EMULATOR_API_URL,
			timeoutMs: env.RCON_TIMEOUT_MS,
			apiKey: env.EMULATOR_API_KEY,
			apiKeyHeader: env.EMULATOR_API_KEY_HEADER,
			maxRetries: env.RCON_MAX_RETRIES,
		});
	}
	return tcpTransport({
		host: env.RCON_HOST,
		port: env.RCON_PORT,
		timeoutMs: env.RCON_TIMEOUT_MS,
		maxRetries: env.RCON_MAX_RETRIES,
	});
}

const globalForRcon = globalThis as unknown as { rcon?: RconClient };

export const rcon =
	globalForRcon.rcon ?? new RconClient(createEmulatorTransport());

if (env.NODE_ENV !== "production") globalForRcon.rcon = rcon;
