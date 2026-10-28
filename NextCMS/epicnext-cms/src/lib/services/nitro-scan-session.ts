import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";
import {
	type CleanupProgress,
	scanFakeBrokenNitros,
} from "@/lib/services/nitro-cleanup";

/**
 * Durable nitro-cleanup scan session.
 *
 * A scan is expensive (hundreds of thousands of stat + header reads), so it is
 * better run as a detached in-process job than blocked inside one request:
 * closing the tab must not lose the scan and a second tab should re-attach
 * instead of starting a duplicate. The session is persisted on disk so the
 * Next.js process keeps working it after the POST that started it has already
 * returned, and a restart mid-scan is recoverable — a "running" session whose
 * heartbeat (`updatedAt`) has gone stale is treated as dead and taken over.
 *
 * The lightweight session record only stores metadata + progress; the actual
 * result lists live in the scan cache (`scan-cache.json`) written by the scan,
 * so a done session is read back without duplicating megabytes of JSON.
 */

export const nitroScanRoot = () =>
	path.join(process.cwd(), "storage", "nitro-cleanup");
const sessionPath = () => path.join(nitroScanRoot(), "session.json");

export type NitroScanState = "running" | "done" | "cancelled" | "error";

export interface NitroScanSession {
	id: string;
	state: NitroScanState;
	startedAt: string;
	updatedAt: string;
	force: boolean;
	progress?: { phase: string; scanned: number };
	cached?: boolean;
	total?: number;
	error?: string;
}

/** A running session that has not been heard from for this long is stale. */
export const SESSION_STALE_MS = 60_000;

/** Thrown when a fresh scan session already exists (single-flight). */
export class NitroScanConflictError extends Error {
	readonly session: NitroScanSession;
	constructor(session: NitroScanSession) {
		super("A nitro scan is already running");
		this.name = "NitroScanConflictError";
		this.session = session;
	}
}

export async function readScanSession(): Promise<NitroScanSession | null> {
	try {
		if (!existsSync(sessionPath())) return null;
		const parsed = JSON.parse(
			await fs.readFile(sessionPath(), "utf8"),
		) as NitroScanSession;
		return parsed && typeof parsed.id === "string" ? parsed : null;
	} catch {
		return null;
	}
}

export async function writeScanSession(
	session: NitroScanSession,
): Promise<void> {
	try {
		await fs.mkdir(nitroScanRoot(), { recursive: true });
		await fs.writeFile(sessionPath(), JSON.stringify(session));
	} catch {
		/* session file is best effort — never fatal */
	}
}

export function isSessionStale(session: NitroScanSession): boolean {
	const age = Date.now() - new Date(session.updatedAt).getTime();
	return !Number.isFinite(age) || age > SESSION_STALE_MS;
}

/**
 * Create a new scan session, or reject with `NitroScanConflictError` when a
 * fresh session is already running (single-flight across the whole server).
 */
export async function startScanSession(options: {
	force: boolean;
}): Promise<NitroScanSession> {
	const current = await readScanSession();
	if (current?.state === "running" && !isSessionStale(current)) {
		throw new NitroScanConflictError(current);
	}
	const now = new Date().toISOString();
	const session: NitroScanSession = {
		id: randomUUID(),
		state: "running",
		startedAt: now,
		updatedAt: now,
		force: options.force,
	};
	await writeScanSession(session);
	return session;
}

interface ActiveScan {
	sessionId: string;
	controller: AbortController;
	promise: Promise<void>;
}

let activeScan: ActiveScan | null = null;

/**
 * Start (or re-attach to) a scan in the background. Resolves with the session
 * quickly; the scan itself keeps running detached in the process. Callers
 * poll `readScanSession()` to follow progress.
 *
 * @throws {NitroScanConflictError} when a fresh (non-stale) scan is already
 *   running — the caller should attach to the returned session instead.
 */
export async function runScanInBackground(options: {
	force: boolean;
}): Promise<NitroScanSession> {
	const session = await startScanSession(options);
	const controller = new AbortController();

	const sessionEvent = async (patch?: {
		progress?: CleanupProgress;
	}): Promise<void> => {
		await writeScanSession({
			...session,
			state: "running",
			...(patch?.progress ? { progress: patch.progress } : {}),
			updatedAt: new Date().toISOString(),
		});
	};

	const run = (async () => {
		try {
			const scan = await scanFakeBrokenNitros({
				force: session.force,
				signal: controller.signal,
				onProgress: (progress) => void sessionEvent({ progress }),
			});
			await writeScanSession({
				...session,
				state: "done",
				cached: scan.cached ?? false,
				total: scan.total,
				progress: { phase: "done", scanned: scan.total },
				updatedAt: new Date().toISOString(),
			});
		} catch (error) {
			if ((error as Error).name === "AbortError") {
				await writeScanSession({
					...session,
					state: "cancelled",
					updatedAt: new Date().toISOString(),
				});
			} else {
				logger.error("Nitro scan failed", {
					module: "nitro-cleanup-session",
					sessionId: session.id,
					error: error instanceof Error ? error.message : String(error),
				});
				await writeScanSession({
					...session,
					state: "error",
					error: error instanceof Error ? error.message : "Scan failed",
					updatedAt: new Date().toISOString(),
				});
			}
		} finally {
			if (activeScan?.sessionId === session.id) activeScan = null;
		}
	})();

	activeScan = { sessionId: session.id, controller, promise: run };
	return session;
}

/** Abort the in-process scan (if any). Returns whether one was aborted. */
export function cancelActiveScan(): boolean {
	if (!activeScan) return false;
	activeScan.controller.abort();
	return true;
}

/** Cancel the scan session regardless of who is running it. */
export async function cancelScanSession(): Promise<NitroScanSession | null> {
	if (cancelActiveScan()) {
		// The detached run observes the abort and marks the session cancelled —
		// wait for that so the caller sees the definitive end state.
		const deadline = Date.now() + 2000;
		let session = await readScanSession();
		while (session?.state === "running" && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 10));
			session = await readScanSession();
		}
		if (session?.state === "running" && session) {
			const cancelled: NitroScanSession = {
				...session,
				state: "cancelled",
				updatedAt: new Date().toISOString(),
			};
			await writeScanSession(cancelled);
			session = cancelled;
		}
		return session;
	}
	const session = await readScanSession();
	if (session?.state === "running") {
		const cancelled: NitroScanSession = {
			...session,
			state: "cancelled",
			updatedAt: new Date().toISOString(),
		};
		await writeScanSession(cancelled);
		return cancelled;
	}
	return session;
}
