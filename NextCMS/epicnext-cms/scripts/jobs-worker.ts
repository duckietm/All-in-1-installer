// Must stay the first import. ESM evaluates a module's imports in source
// order, and `../src/features/operations/worker` reaches `@/env`, which parses
// process.env at import time. With this import further down the tree, load-env
// ran *after* the schema validation had already thrown on a missing
// DATABASE_URL, so the worker could only ever start from an environment that
// already exported the config — which is why `pnpm jobs:worker` died
// immediately and nothing supervised it.
import "./load-env";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { Cron } from "croner";
import { lt, sql } from "drizzle-orm";
import { env } from "../src/env";
import { drainOperationEffects } from "../src/features/operations/worker";
import { db, PasswordReset, WebsiteLoginLogs } from "../src/lib/db";
import { logger } from "../src/lib/logger";
import { redis } from "../src/lib/redis";
import {
	diskPressure,
	emulatorOffline,
	healthDegraded,
} from "../src/lib/services/alert";
import { runCatalogExport } from "../src/lib/services/catalog-git-export";
import {
	DISK_THRESHOLDS,
	diskLevel,
	parseDfOutput,
} from "../src/lib/services/disk-usage";
import { drainFurnitureImports } from "../src/lib/services/furni-job-worker";
import { publishDueArticles } from "../src/lib/services/news-scheduler";
import { scheduledAutoCleanFakeNitros } from "../src/lib/services/nitro-cleanup";
import { rcon } from "../src/lib/services/rcon";

function captureWorkerError(err: unknown, context: string): void {
	logger.error(context, {
		module: "jobs",
		err: err instanceof Error ? err.message : String(err),
	});
}

/** In-process cooldown so a flapping probe does not spam Discord/email. */
const alertCooldownMs = (env.HEALTH_ALERT_COOLDOWN_MIN ?? 15) * 60_000;
const lastHealthAlertAt = new Map<string, number>();

function canAlert(key: string): boolean {
	const now = Date.now();
	const prev = lastHealthAlertAt.get(key) ?? 0;
	if (now - prev < alertCooldownMs) return false;
	lastHealthAlertAt.set(key, now);
	return true;
}

async function probeHealth(): Promise<{
	database: boolean;
	redis: boolean | null;
	emulator: boolean;
}> {
	const database = await db
		.execute(sql`SELECT 1`)
		.then(() => true)
		.catch(() => false);

	let redisOk: boolean | null = null;
	if (env.REDIS_URL) {
		if (!redis) {
			redisOk = false;
		} else {
			try {
				redisOk = (await redis.ping()) === "PONG";
			} catch {
				redisOk = false;
			}
		}
	}

	const emulator = await rcon.send("ping", null).catch(() => false);
	return {
		database,
		redis: redisOk,
		emulator: Boolean(emulator),
	};
}

async function checkOpsHealth(): Promise<void> {
	try {
		const health = await probeHealth();
		const degraded =
			!health.database || health.redis === false || !health.emulator;
		if (!degraded) return;

		if (!health.emulator && health.database && health.redis !== false) {
			if (canAlert("emulator")) {
				await emulatorOffline("jobs-worker RCON ping failed");
			}
			return;
		}

		if (canAlert("health")) {
			await healthDegraded(health);
		}
	} catch (err) {
		captureWorkerError(err, "Health probe failed");
	}
}

/**
 * Host-side: probe filesystem fill levels via `df -P -B1` and raise a
 * diskPressure() alert per mount once it crosses 85/90/95% (cooldown-gated per
 * mount+level so a stuck fill level does not spam Discord/email).
 */
async function checkDiskUsage(): Promise<void> {
	const { execFile } = await import("node:child_process");

	let dfOut: string;
	try {
		dfOut = await new Promise<string>((resolve, reject) => {
			execFile(
				"df",
				["-P", "-B1"],
				{
					maxBuffer: 4 * 1024 * 1024,
					timeout: 15_000,
				},
				(err, stdout) => (err ? reject(err) : resolve(stdout)),
			);
		});
	} catch (err) {
		captureWorkerError(err, "Disk probe failed (is df available?)");
		return;
	}

	const mounts = parseDfOutput(dfOut);
	if (mounts.length === 0) return;

	for (const usage of mounts) {
		const level = diskLevel(usage.percent);
		if (level === 0) continue;
		if (canAlert(`disk-${usage.mount}-${level}`)) {
			logger.warn("Raising disk usage alert", {
				module: "jobs",
				mount: usage.mount,
				percent: usage.percent,
			});
			await diskPressure(usage);
		}

		// Self-healing: never let a mount max out. Safe prune from the warning
		// mark, forced prune (drop age windows) from the error mark. Cooldown is
		// keyed separately so a stuck fill level does not re-prune every run
		// while still escalating to the forced path on real pressure.
		if (usage.percent >= DISK_THRESHOLDS.error) {
			if (canAlert(`disk-prune-force-${usage.mount}`)) {
				logger.warn("Disk near full — forcing Docker cache reclaim", {
					module: "jobs",
					mount: usage.mount,
					percent: usage.percent,
				});
				await pruneDockerCache(true);
			}
		} else if (usage.percent >= DISK_THRESHOLDS.warning) {
			if (canAlert(`disk-prune-${usage.mount}`)) {
				logger.info("Disk at high water mark — running safe Docker prune", {
					module: "jobs",
					mount: usage.mount,
					percent: usage.percent,
				});
				await pruneDockerCache(false);
			}
		}
	}
}

/**
 * Resolve the JAR to back up. `EMULATOR_JAR_PATH` may point at the file itself
 * or at a directory of release JARs, because the emulator's own unit file
 * launches `ls -t Polaris-*-jar-with-dependencies.jar` — a path pinned to one
 * release filename goes stale on the next emulator upgrade, and a stale path
 * fails as a bare ENOENT from copyFile that gives no hint what is wrong. A
 * directory (or a path with a `*`) resolves to the most recently modified JAR,
 * matching how the emulator actually picks its build.
 */
export function resolveEmulatorJar(
	configuredPath: string,
	fs: typeof import("node:fs") = nodeFs,
	{ resolve }: typeof import("node:path") = nodePath,
): string | null {
	const { existsSync, readdirSync, statSync } = fs;
	if (configuredPath.includes("*")) {
		const dir = configuredPath.slice(0, configuredPath.lastIndexOf("/") + 1);
		const pattern = configuredPath.slice(dir.length);
		if (!existsSync(dir)) return null;
		return (
			readdirSync(dir)
				.filter((name: string) => name.startsWith(pattern.split("*")[0] ?? ""))
				.map((name: string) => resolve(dir, name))
				.filter((path: string) => existsSync(path))
				.sort(
					(a: string, b: string) => statSync(b).mtimeMs - statSync(a).mtimeMs,
				)[0] ?? null
		);
	}
	if (existsSync(configuredPath) && statSync(configuredPath).isFile())
		return configuredPath;
	// A directory: take the newest JAR in it.
	if (existsSync(configuredPath) && statSync(configuredPath).isDirectory()) {
		return (
			readdirSync(configuredPath)
				.filter((name: string) => name.endsWith(".jar"))
				.map((name: string) => resolve(configuredPath, name))
				.sort(
					(a: string, b: string) => statSync(b).mtimeMs - statSync(a).mtimeMs,
				)[0] ?? null
		);
	}
	return null;
}

async function backupEmulatorJar(): Promise<void> {
	if (!env.EMULATOR_JAR_PATH || !env.EMULATOR_BACKUP_DIR) return;

	const fs = await import("node:fs");
	const { copyFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } = fs;
	const { resolve } = await import("node:path");

	const jarPath = resolveEmulatorJar(env.EMULATOR_JAR_PATH, fs, nodePath);
	if (!jarPath) {
		// Configured but unusable: say so once, loudly, instead of every night
		// logging an opaque copyFile ENOENT that reads like a permissions bug.
		logger.error(
			"Emulator JAR backup skipped: EMULATOR_JAR_PATH does not resolve to a JAR",
			{ module: "jobs", configured: env.EMULATOR_JAR_PATH },
		);
		return;
	}

	const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
	const backupFile = resolve(
		env.EMULATOR_BACKUP_DIR,
		`emulator-${timestamp}.jar`,
	);

	if (!existsSync(env.EMULATOR_BACKUP_DIR)) {
		mkdirSync(env.EMULATOR_BACKUP_DIR, { recursive: true });
	}

	try {
		copyFileSync(jarPath, backupFile);
		logger.info("Backed up emulator JAR", {
			module: "jobs",
			backupFile,
			source: jarPath,
		});

		const keep = env.EMULATOR_BACKUP_KEEP ?? 7;
		const files = readdirSync(env.EMULATOR_BACKUP_DIR)
			.filter((f) => f.startsWith("emulator-") && f.endsWith(".jar"))
			.sort()
			.reverse();

		for (let i = keep; i < files.length; i++) {
			unlinkSync(resolve(env.EMULATOR_BACKUP_DIR, files[i]));
			logger.info("Rotated out old backup", {
				module: "jobs",
				file: files[i],
			});
		}
	} catch (err) {
		captureWorkerError(err, "JAR backup failed");
	}
}

/** Optional mysqldump when DB_BACKUP_DIR is set (host must have mysqldump on PATH). */
async function backupDatabase(): Promise<void> {
	const backupDir = env.DB_BACKUP_DIR;
	if (!backupDir || !env.DATABASE_URL) return;

	const { mkdirSync, readdirSync, unlinkSync, existsSync, createWriteStream } =
		await import("node:fs");
	const { resolve } = await import("node:path");
	const { spawn } = await import("node:child_process");

	let parsed: URL;
	try {
		parsed = new URL(env.DATABASE_URL);
	} catch {
		logger.error("Invalid DATABASE_URL for DB backup", { module: "jobs" });
		return;
	}

	if (!existsSync(backupDir)) {
		mkdirSync(backupDir, { recursive: true });
	}

	const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
	const dbName =
		decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "cms";
	const outFile = resolve(backupDir, `db-${dbName}-${timestamp}.sql`);

	const args = [
		`-h${parsed.hostname}`,
		`-P${parsed.port || "3306"}`,
		`-u${decodeURIComponent(parsed.username)}`,
		`--single-transaction`,
		`--routines`,
		`--databases`,
		dbName,
	];
	if (parsed.password) {
		args.splice(3, 0, `-p${decodeURIComponent(parsed.password)}`);
	}

	await new Promise<void>((resolvePromise) => {
		const child = spawn("mysqldump", args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const out = createWriteStream(outFile);
		child.stdout.pipe(out);
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", (err) => {
			captureWorkerError(err, "mysqldump spawn failed (is it on PATH?)");
			resolvePromise();
		});
		child.on("close", (code) => {
			out.end();
			if (code !== 0) {
				captureWorkerError(
					new Error(stderr || `mysqldump exit ${code}`),
					"DB backup failed",
				);
			} else {
				logger.info("Backed up database", { module: "jobs", outFile });
				const keep = env.DB_BACKUP_KEEP ?? 7;
				const files = readdirSync(backupDir)
					.filter((f) => f.startsWith("db-") && f.endsWith(".sql"))
					.sort()
					.reverse();
				for (let i = keep; i < files.length; i++) {
					const file = files[i];
					if (file) unlinkSync(resolve(backupDir, file));
				}
			}
			resolvePromise();
		});
	});
}

async function cleanupOldLogs(): Promise<void> {
	try {
		const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		await db
			.delete(WebsiteLoginLogs)
			.where(lt(WebsiteLoginLogs.createdAt, cutoff));
		logger.info("Cleaned up login logs older than 30 days", { module: "jobs" });
	} catch (err) {
		captureWorkerError(err, "Log cleanup failed");
	}
}

async function cleanupOldSessions(): Promise<void> {
	try {
		const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
		await db.delete(PasswordReset).where(lt(PasswordReset.createdAt, cutoff));
		logger.info("Cleaned up expired password reset tokens", {
			module: "jobs",
		});
	} catch (err) {
		captureWorkerError(err, "Session cleanup failed");
	}
}

/** Host-side: reclaim Docker's unused cache (build cache, unreferenced images,
 * stopped containers). Volumes and in-use images are never touched. No-op when
 * docker or the prune script is unavailable. With force=true the age windows
 * are dropped (docker-prune.sh --force) so every unused byte is reclaimed —
 * the emergency path for a nearly-full disk. */
async function pruneDockerCache(force = false): Promise<void> {
	const { access } = await import("node:fs/promises");
	const { resolve } = await import("node:path");
	const { spawn } = await import("node:child_process");
	const script = resolve(process.cwd(), "scripts", "docker-prune.sh");
	try {
		await access(script);
	} catch {
		return;
	}
	await new Promise<void>((resolvePromise) => {
		const child = spawn("bash", [script, ...(force ? ["--force"] : [])], {
			stdio: "ignore",
		});
		child.on("error", (err) =>
			captureWorkerError(
				err,
				"Docker prune could not start (is bash on PATH?)",
			),
		);
		child.on("close", (code) => {
			if (code !== 0)
				captureWorkerError(
					new Error(`docker-prune.sh exited ${code}`),
					"Docker prune failed",
				);
			resolvePromise();
		});
	});
}

async function publishScheduledArticles(): Promise<void> {
	try {
		const published = await publishDueArticles();
		if (published > 0) {
			logger.info(`Published ${published} scheduled article(s)`, {
				module: "jobs",
			});
		}
	} catch (err) {
		captureWorkerError(err, "Scheduled article publish failed");
	}
}

/** Nightly self-cleaning of old fake .nitro leftovers (skips when a scan is
 * running in the studio). Requires the `items_base` truth list, so a DB outage
 * shows up here as a captured error instead of deleting anything. */
async function autoCleanNitroFakes(): Promise<void> {
	try {
		const result = await scheduledAutoCleanFakeNitros(30);
		if (result.skipped) {
			logger.info("Skipped nightly nitro auto-clean: scan in progress", {
				module: "jobs",
			});
		} else {
			logger.info("Nightly nitro auto-clean finished", {
				module: "jobs",
				deleted: result.deleted,
			});
		}
	} catch (err) {
		captureWorkerError(err, "Nitro auto-clean failed");
	}
}

async function reportWorkerHeartbeat(): Promise<void> {
	if (!redis) return;
	await redis
		.set("cms:jobs-worker:heartbeat", new Date().toISOString(), "EX", 600)
		.catch((error) => captureWorkerError(error, "WorkerHeartbeat"));
}

async function main() {
	new Cron("* * * * *", () => {
		void drainOperationEffects();
	});
	void drainOperationEffects();
	new Cron("* * * * *", () => {
		void drainFurnitureImports();
	});
	void drainFurnitureImports();
	new Cron("* * * * *", () => {
		runCatalogExport().catch((e) =>
			captureWorkerError(e, "Catalog export failed"),
		);
	});
	logger.info("Worker started", { module: "jobs" });

	if (env.EMULATOR_JAR_PATH && env.EMULATOR_BACKUP_DIR) {
		new Cron("0 3 * * *", () => {
			backupEmulatorJar().catch((e) => captureWorkerError(e, "Backup error"));
		});
		logger.info("Scheduled: emulator JAR backup (daily 03:00)", {
			module: "jobs",
		});
	}

	if (env.DB_BACKUP_DIR) {
		new Cron("30 3 * * *", () => {
			backupDatabase().catch((e) => captureWorkerError(e, "DB backup error"));
		});
		logger.info("Scheduled: mysqldump DB backup (daily 03:30)", {
			module: "jobs",
		});
	}

	new Cron("0 4 * * *", () => {
		Promise.all([cleanupOldLogs(), cleanupOldSessions()]).catch((e) =>
			captureWorkerError(e, "Cleanup error"),
		);
	});
	logger.info("Scheduled: old data cleanup (daily 04:00)", { module: "jobs" });

	new Cron("0 5 * * *", () => {
		pruneDockerCache().catch((e) =>
			captureWorkerError(e, "Docker prune error"),
		);
	});
	logger.info("Scheduled: Docker cache prune (daily 05:00)", {
		module: "jobs",
	});

	new Cron("*/5 * * * *", () => {
		checkOpsHealth().catch((e) => captureWorkerError(e, "Health check error"));
	});
	logger.info("Scheduled: ops health probe (every 5 min)", { module: "jobs" });

	new Cron("*/5 * * * *", () => {
		checkDiskUsage().catch((e) => captureWorkerError(e, "Disk check error"));
	});
	logger.info("Scheduled: disk usage probe (every 5 min)", { module: "jobs" });

	new Cron("* * * * *", () => {
		publishScheduledArticles().catch((e) =>
			captureWorkerError(e, "ScheduledArticlePublish"),
		);
	});
	logger.info("Scheduled: publish scheduled articles (every minute)", {
		module: "jobs",
	});

	new Cron("* * * * *", () => {
		void reportWorkerHeartbeat();
	});
	await reportWorkerHeartbeat();

	new Cron("0 2 * * *", () => {
		autoCleanNitroFakes().catch((e) =>
			captureWorkerError(e, "Nitro auto-clean error"),
		);
	});
	logger.info("Scheduled: nitro auto-clean (daily 02:00)", {
		module: "jobs",
	});

	new Cron("*/30 * * * *", () => {
		// Purge the gamedata edge tag periodically as a safety net in case a
		// single import failed to emit a purge (e.g. Cloudflare disabled at the
		// moment of write). Without it, a long TTL on /gamedata/ would keep the
		// client stuck on old FurnitureData.json until the browser or CDN cache
		// expired. No-op when Cloudflare is not configured.
		import("../src/lib/edge-cache")
			.then(({ EDGE_CACHE_TAGS, purgeEdgeCache }) =>
				purgeEdgeCache([EDGE_CACHE_TAGS.gamedata], "jobs-safety-net"),
			)
			.catch((e) =>
				captureWorkerError(e, "Gamedata edge purge (safety net) failed"),
			);
	});
	logger.info("Scheduled: gamedata edge purge safety net (every 30 min)", {
		module: "jobs",
	});
	await Promise.all([
		backupEmulatorJar(),
		cleanupOldLogs(),
		cleanupOldSessions(),
		checkOpsHealth(),
		checkDiskUsage(),
	]);
}

main().catch((err) => {
	captureWorkerError(err, "Fatal");
	process.exit(1);
});
