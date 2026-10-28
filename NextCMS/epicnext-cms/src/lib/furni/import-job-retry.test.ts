import { expect, it } from "vitest";
import type { ImportJob } from "./import-job";
import { retryableJobItems } from "./import-job-retry";

const job = (state: ImportJob["state"]) =>
	({
		state,
		items: [
			"done",
			"failed",
			"pending",
			"running",
			"cancelled",
			"interrupted",
		].map((state) => ({
			state,
			classname: state,
		})),
	}) as ImportJob;
it("only retries failures after a completed job", () =>
	expect(retryableJobItems(job("completed")).map((i) => i.state)).toEqual([
		"failed",
	]));
it("recovers only safe unfinished items from an interrupted job", () =>
	expect(retryableJobItems(job("interrupted")).map((i) => i.state)).toEqual([
		"failed",
		"pending",
		"cancelled",
	]));
it.each(["queued", "running"] as const)("never duplicates a %s job", (state) =>
	expect(retryableJobItems(job(state))).toEqual([]),
);

it("retries cancelled remaining work without redoing completed or uncertain items", () => {
	expect(retryableJobItems(job("cancelled")).map((i) => i.state)).toEqual([
		"failed",
		"pending",
		"cancelled",
	]);
});

it("does not blindly retry legacy interrupted mutations stored as failures", () => {
	const interrupted = job("interrupted");
	interrupted.items = [
		{
			...interrupted.items[0],
			state: "failed",
			error:
				"Server restarted during import. Review local data and retry to complete missing parts.",
		},
	];
	expect(retryableJobItems(interrupted)).toEqual([]);
});
