import "server-only";
import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import {
	type DiagnosticState,
	migrationState,
	workerState,
} from "@/lib/admin/installation-state";
import { fetchOpsHealth } from "@/lib/admin/ops-health";
import { queryRows } from "@/lib/db";
import { redis } from "@/lib/redis";
import { siteSettings } from "@/lib/services/site-settings";

export async function inspectInstallation() {
	const started = performance.now();
	const [health, storage, expected, applied, heartbeat, renderer] =
		await Promise.all([
			fetchOpsHealth(),
			Promise.all(
				["storage", "public/nitro-assets", "public/swf"].map(async (name) => ({
					name,
					state: await access(
						path.join(process.cwd(), name),
						constants.R_OK | constants.W_OK,
					)
						.then(() => "ok" as const)
						.catch(() => "failed" as const),
				})),
			),
			readdir(path.join(process.cwd(), "drizzle/migrations"))
				.then((files) =>
					files
						.filter((name) => name.endsWith(".sql"))
						.map((name) => name.slice(0, -4)),
				)
				.catch(() => []),
			queryRows<{ migration: string }>(
				sql`SELECT migration FROM cms_migrations`,
			)
				.then((rows) => rows.map((row) => row.migration))
				.catch(() => null),
			redis
				? redis.get("cms:jobs-worker:heartbeat").catch(() => null)
				: Promise.resolve(null),
			siteSettings.get("nitro_client_url", "").catch(() => ""),
		]);
	const migration = migrationState(expected, applied);
	const release = process.env.NEXT_PUBLIC_CMS_RELEASE ?? "unknown";
	const rows: Array<{ key: string; state: DiagnosticState; detail?: string }> =
		[
			{
				key: "release",
				state: /^[a-f0-9]{40}$/i.test(release) ? "ok" : "unknown",
				detail: /^[a-f0-9]{40}$/i.test(release) ? release : undefined,
			},
			{
				key: "database",
				state: health.dbOk ? "ok" : "failed",
				detail: health.dbOk ? `${health.dbLatencyMs} ms` : undefined,
			},
			{
				key: "redis",
				state:
					health.redisOk === null
						? "missing"
						: health.redisOk
							? "ok"
							: "failed",
			},
			{ key: "emulator", state: health.emulatorOk ? "ok" : "failed" },
			{
				key: "storage",
				state: storage.every((item) => item.state === "ok") ? "ok" : "failed",
				detail:
					storage
						.filter((item) => item.state !== "ok")
						.map((item) => item.name)
						.join(", ") || undefined,
			},
			{
				key: "migrations",
				state: migration.state,
				detail:
					migration.pending === null ? undefined : String(migration.pending),
			},
			{
				key: "worker",
				state: workerState(heartbeat),
				detail:
					heartbeat && Number.isFinite(Date.parse(heartbeat))
						? new Date(heartbeat).toISOString()
						: undefined,
			},
			{
				key: "renderer",
				state: health.dbOk ? "ok" : "unknown",
				detail: health.dbOk && !renderer ? "/client/index.html" : undefined,
			},
			{ key: "registry", state: "unknown" },
		];
	return {
		rows,
		checkedAt: new Date().toISOString(),
		durationMs: Math.round(performance.now() - started),
	};
}
