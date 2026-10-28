import { z } from "zod";
import type { PerformanceMetrics } from "@/lib/performance-diagnostics";
import { redis } from "@/lib/redis";

const KEY = "cms:performance:v1";
const LIMIT = 200;
const RETENTION_MS = 60 * 60 * 1000;
const measurement = z.object({
	count: z.number().nonnegative(),
	durationMs: z.number().nonnegative(),
	errors: z.number().nonnegative(),
});
const schema = z.object({
	kind: z.enum(["admin-api", "public-page"]).optional(),
	outcome: z.enum(["completed", "failed", "redirect", "not-found"]).optional(),
	operationId: z.string().max(100),
	route: z.string().max(300),
	method: z.string().max(10),
	status: z.number().int(),
	at: z.number(),
	streaming: z.boolean(),
	metrics: z.object({
		durationMs: z.number().nonnegative(),
		database: measurement,
		external: measurement,
	}),
});
export interface PerformanceSample {
	kind?: "admin-api" | "public-page";
	outcome?: "completed" | "failed" | "redirect" | "not-found";
	operationId: string;
	route: string;
	method: string;
	status: number;
	at: number;
	streaming: boolean;
	metrics: PerformanceMetrics;
}
const state = globalThis as typeof globalThis & {
	cmsPerformance?: {
		samples: PerformanceSample[];
		publicSamples?: PerformanceSample[];
		pending: number;
	};
};
const buffer = state.cmsPerformance ?? { samples: [], pending: 0 };
state.cmsPerformance = buffer;

/** Best effort: no connection wait, no unbounded offline queue, no request failure. */
export function recordPerformance(sample: PerformanceSample): void {
	const samples =
		sample.kind === "public-page"
			? (buffer.publicSamples ?? [])
			: buffer.samples;
	if (sample.kind === "public-page") buffer.publicSamples = samples;
	samples.unshift(sample);
	samples.length = Math.min(samples.length, LIMIT);
	const key = sample.kind === "public-page" ? `${KEY}:public` : KEY;
	if (redis?.status !== "ready" || buffer.pending >= 4) return;
	buffer.pending++;
	try {
		void redis
			.multi()
			.lpush(key, JSON.stringify(sample))
			.ltrim(key, 0, LIMIT - 1)
			.expire(key, 3600)
			.exec()
			.catch(() => undefined)
			.finally(() => {
				buffer.pending--;
			});
	} catch {
		buffer.pending--;
	}
}

export async function readPerformance(
	kind: "admin-api" | "public-page" = "admin-api",
): Promise<{
	samples: PerformanceSample[];
	shared: boolean;
}> {
	const cutoff = Date.now() - RETENTION_MS;
	const key = kind === "public-page" ? `${KEY}:public` : KEY;
	const local =
		kind === "public-page" ? (buffer.publicSamples ?? []) : buffer.samples;
	if (redis?.status === "ready") {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const rows = await Promise.race([
				redis.lrange(key, 0, LIMIT - 1),
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("Diagnostic storage timeout")),
						1000,
					);
				}),
			]);
			const samples = rows.flatMap((row) => {
				try {
					const sample = schema.safeParse(JSON.parse(row));
					return sample.success && sample.data.at >= cutoff
						? [sample.data]
						: [];
				} catch {
					return [];
				}
			});
			return { samples, shared: true };
		} catch {
			/* Keep local diagnostics available during a Redis outage. */
		} finally {
			clearTimeout(timer);
		}
	}
	return {
		samples: local.filter((sample) => sample.at >= cutoff),
		shared: false,
	};
}
