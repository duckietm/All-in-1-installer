import { promises as fs } from "node:fs";
import { logger } from "@/lib/logger";

const LOCK_STALE_MS = 60_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 30_000;
const CHAIN_TIMEOUT_MS = 60_000;

// In-process serialization, keyed by absolute file path, layered on top of the
// on-disk lock so multiple awaiters in the same Node process queue cleanly.
const chains = new Map<string, Promise<void>>();
const chainTimestamps = new Map<string, number>();

async function acquireDiskLock(lockPath: string): Promise<void> {
	const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
	while (true) {
		try {
			const fh = await fs.open(/*turbopackIgnore: true*/ lockPath, "wx");
			await fh.writeFile(String(process.pid));
			await fh.close();
			return;
		} catch (err) {
			const e = err as NodeJS.ErrnoException;
			if (e.code !== "EEXIST") throw err;
			try {
				const stat = await fs.stat(/*turbopackIgnore: true*/ lockPath);
				if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
					await fs.unlink(/*turbopackIgnore: true*/ lockPath).catch(() => {});
					continue;
				}
			} catch {
				/* lock vanished between checks */
			}
			if (Date.now() > deadline)
				throw new Error(`gamedata lock timeout: ${lockPath}`);
			await new Promise((r) => setTimeout(r, 100));
		}
	}
}

/**
 * Wait for the previous chain holder with a timeout.
 * If the chain holder stalled (e.g. process crash, unhandled rejection),
 * we break the chain instead of waiting forever.
 */
async function waitForChain(filePath: string): Promise<void> {
	const prev = chains.get(filePath);
	if (!prev) return;

	const timestamp = chainTimestamps.get(filePath) ?? 0;
	const elapsed = Date.now() - timestamp;

	if (elapsed > CHAIN_TIMEOUT_MS) {
		// Previous holder took too long — break the chain
		logger.warn(
			`[gamedata-lock] Breaking stale chain for ${filePath} (held for ${elapsed}ms)`,
		);
		chains.delete(filePath);
		chainTimestamps.delete(filePath);
		return;
	}

	try {
		await Promise.race([
			prev,
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error("chain timeout")),
					Math.max(1, CHAIN_TIMEOUT_MS - elapsed),
				),
			),
		]);
	} catch {
		// Chain holder timed out or crashed — break the chain
		logger.warn(
			`[gamedata-lock] Chain timeout for ${filePath}, breaking chain`,
		);
		chains.delete(filePath);
		chainTimestamps.delete(filePath);
	}
}

export async function withGamedataLock<T>(
	filePath: string,
	fn: () => Promise<T>,
): Promise<T> {
	let release!: () => void;
	const acquired = new Promise<void>((r) => {
		release = r;
	});

	await waitForChain(filePath);

	chains.set(filePath, acquired);
	chainTimestamps.set(filePath, Date.now());

	const lockPath = `${filePath}.lock`;
	await acquireDiskLock(lockPath);
	try {
		return await fn();
	} finally {
		await fs.unlink(/*turbopackIgnore: true*/ lockPath).catch(() => {});
		chains.delete(filePath);
		chainTimestamps.delete(filePath);
		release();
	}
}

export async function readGamedataJson<T>(filePath: string): Promise<T> {
	const raw = await fs.readFile(/*turbopackIgnore: true*/ filePath, "utf-8");
	return JSON.parse(raw) as T;
}

export async function writeGamedataJsonAtomic(
	filePath: string,
	data: unknown,
): Promise<void> {
	const tmp = `${filePath}.tmp`;
	await fs.writeFile(
		/*turbopackIgnore: true*/ tmp,
		JSON.stringify(data, null, 2),
		"utf-8",
	);
	await fs.rename(/*turbopackIgnore: true*/ tmp, filePath);
}
