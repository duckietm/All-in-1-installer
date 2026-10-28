import { AsyncLocalStorage } from "node:async_hooks";

type Dependency = "database" | "external";
type Measurement = { count: number; durationMs: number; errors: number };
export type PerformanceMetrics = Record<Dependency, Measurement> & {
	durationMs: number;
};
const context = new AsyncLocalStorage<PerformanceMetrics>();

export async function collectPerformance<T>(
	work: () => Promise<T>,
	onComplete?: (metrics: PerformanceMetrics) => void,
) {
	const metrics: PerformanceMetrics = {
		durationMs: 0,
		database: { count: 0, durationMs: 0, errors: 0 },
		external: { count: 0, durationMs: 0, errors: 0 },
	};
	const start = performance.now();
	try {
		const value = await context.run(metrics, work);
		metrics.durationMs = performance.now() - start;
		return { value, metrics: structuredClone(metrics) };
	} finally {
		metrics.durationMs = performance.now() - start;
		try {
			onComplete?.(structuredClone(metrics));
		} catch {
			/* Diagnostics must not change application outcomes. */
		}
	}
}

export async function measureDependency<T>(
	kind: Dependency,
	work: () => Promise<T>,
): Promise<T> {
	const metrics = context.getStore();
	if (!metrics) return work();
	const start = performance.now();
	const measurement = metrics[kind];
	try {
		return await work();
	} catch (error) {
		measurement.errors++;
		throw error;
	} finally {
		measurement.count++;
		measurement.durationMs += performance.now() - start;
	}
}

/** Promise driver only. Preserve receiver, overloads and connection release behavior. */
export function instrumentDatabase<T extends object>(driver: T): T {
	return new Proxy(driver, {
		get(target, property) {
			const value = Reflect.get(target, property, target);
			if (typeof value !== "function") return value;
			if (property === "query" || property === "execute") {
				return (...args: unknown[]) =>
					measureDependency("database", () =>
						Reflect.apply(value, target, args),
					);
			}
			if (property === "getConnection") {
				return async (...args: unknown[]) =>
					instrumentDatabase(await Reflect.apply(value, target, args));
			}
			return value.bind(target);
		},
	});
}

export function routeTemplate(
	pathname: string,
	params: Record<string, string | string[]> = {},
) {
	const dynamic = new Map<string, string>();
	for (const [key, value] of Object.entries(params)) {
		for (const part of Array.isArray(value) ? value : [value])
			dynamic.set(part, `[${key}]`);
	}
	return pathname
		.split("?")[0]
		.split("/")
		.map((part) => {
			let decoded = part;
			try {
				decoded = decodeURIComponent(part);
			} catch {
				return "[invalid]";
			}
			return dynamic.get(decoded) ?? (/^\d+$/.test(part) ? "[id]" : part);
		})
		.join("/")
		.slice(0, 300);
}
