import { describe, expect, it } from "vitest";
import { runSseBatch } from "./sse-batch";

async function collect(res: Response): Promise<Array<Record<string, unknown>>> {
	const text = await res.text();
	return text
		.split("\n\n")
		.filter((l) => l.startsWith("data: "))
		.map((l) => JSON.parse(l.slice(6)));
}

describe("import/core/sse-batch", () => {
	it("emits batch_start, per-item, and batch_complete with correct counts", async () => {
		const res = runSseBatch({
			items: ["a", "b", "c"],
			concurrency: 2,
			worker: async (item) => ({
				ok: item !== "b",
				error: item === "b" ? "boom" : undefined,
			}),
			labelOf: (item) => item,
		});
		const events = await collect(res);
		expect(events[0]).toMatchObject({
			type: "batch_start",
			total: 3,
			concurrency: 2,
		});
		const done = events.filter(
			(e) => e.type === "item_progress" && e.status === "done",
		);
		const failed = events.filter(
			(e) => e.type === "item_progress" && e.status === "failed",
		);
		expect(done).toHaveLength(2);
		expect(failed).toHaveLength(1);
		expect(events.at(-1)).toMatchObject({
			type: "batch_complete",
			succeeded: 2,
			failed: 1,
		});
	});

	it("stops starting new chunks when AbortSignal fires", async () => {
		const ac = new AbortController();
		let started = 0;
		const res = runSseBatch({
			items: ["a", "b", "c", "d"],
			concurrency: 1,
			signal: ac.signal,
			labelOf: (item) => item,
			worker: async (item) => {
				started++;
				if (item === "a") ac.abort();
				// Slow enough that abort lands before the next chunk starts.
				await new Promise((r) => setTimeout(r, 20));
				return { ok: true };
			},
		});
		const events = await collect(res);
		expect(started).toBeLessThan(4);
		expect(events.some((e) => e.type === "batch_complete")).toBe(false);
		expect(events[0]).toMatchObject({ type: "batch_start", total: 4 });
	});
});
