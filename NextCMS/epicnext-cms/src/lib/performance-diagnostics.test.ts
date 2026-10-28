// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
	collectPerformance,
	instrumentDatabase,
	measureDependency,
	routeTemplate,
} from "./performance-diagnostics";

describe("performance diagnostics", () => {
	it("isolates concurrent requests and preserves results and errors", async () => {
		const error = new Error("private SQL parameters");
		const [a, b] = await Promise.all([
			collectPerformance(async () => {
				await measureDependency("database", async () => 42);
				await expect(
					measureDependency("external", async () => {
						throw error;
					}),
				).rejects.toBe(error);
				return "first";
			}),
			collectPerformance(async () => "second"),
		]);
		expect(a.value).toBe("first");
		expect(a.metrics.database.count).toBe(1);
		expect(a.metrics.external.count).toBe(1);
		expect(a.metrics.external.errors).toBe(1);
		expect(b.metrics.database.count).toBe(0);
		expect(JSON.stringify(a.metrics)).not.toContain("private");
	});
	it("measures pool and transaction queries without changing receiver or arguments", async () => {
		const connection = {
			query: async (sql: string) => sql,
			release() {
				return this;
			},
		};
		const original = {
			marker: 42,
			async execute(value: number) {
				return this.marker + value;
			},
			async getConnection() {
				return connection;
			},
		};
		const pool = instrumentDatabase(original);
		const result = await collectPerformance(async () => {
			expect(await pool.execute(8)).toBe(50);
			const conn = await pool.getConnection();
			expect(await conn.query("secret SQL")).toBe("secret SQL");
			expect(conn.release()).toBe(connection);
		});
		expect(result.metrics.database.count).toBe(2);
		expect(JSON.stringify(result.metrics)).not.toContain("secret");
	});
	it("removes query strings and dynamic path values including encoded catch-all segments", () => {
		expect(
			routeTemplate("/api/admin/users/Life?token=private", {
				username: "Life",
			}),
		).toBe("/api/admin/users/[username]");
		expect(
			routeTemplate("/api/admin/assets/a%20b/file.png", {
				path: ["a b", "file.png"],
			}),
		).toBe("/api/admin/assets/[path]/[path]");
	});
});

it("does not change a completed snapshot when background work finishes", async () => {
	let finish!: () => void;
	let background!: Promise<void>;
	const result = await collectPerformance(async () => {
		background = measureDependency(
			"external",
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
	});
	expect(result.metrics.external.count).toBe(0);
	finish();
	await background;
	expect(result.metrics.external.count).toBe(0);
});

it("reports timings on failure without replacing the application error", async () => {
	const error = new Error("original");
	let captured = 0;
	await expect(
		collectPerformance(
			async () => {
				await measureDependency("database", async () => {
					throw error;
				});
			},
			(metrics) => {
				captured = metrics.database.errors;
				throw Error("telemetry failure");
			},
		),
	).rejects.toBe(error);
	expect(captured).toBe(1);
});
