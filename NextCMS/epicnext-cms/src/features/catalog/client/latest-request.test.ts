import { describe, expect, it } from "vitest";
import { createLatestRequest } from "./latest-request";

describe("catalog request ownership", () => {
	it("keeps the latest category when an earlier transport completes last", async () => {
		const requests = createLatestRequest();
		let displayed = "";
		let finishOld!: (value: string) => void;
		const oldResponse = new Promise<string>((resolve) => {
			finishOld = resolve;
		});
		const oldRequest = requests.start();
		const oldWork = oldResponse.then((value) => {
			if (oldRequest.isCurrent()) displayed = value;
		});
		const current = requests.start();
		await Promise.resolve("category B").then((value) => {
			if (current.isCurrent()) displayed = value;
		});
		finishOld("category A");
		await oldWork;
		expect(oldRequest.signal.aborted).toBe(true);
		expect(displayed).toBe("category B");
	});
	it("ignores late save/read completion after editor unmount", () => {
		const requests = createLatestRequest();
		const pending = requests.start();
		requests.cancel();
		expect(pending.signal.aborted).toBe(true);
		expect(pending.isCurrent()).toBe(false);
	});
	it("allows a fresh request after effect cleanup and isolates page/items channels", () => {
		const pages = createLatestRequest();
		const items = createLatestRequest();
		const page = pages.start();
		const firstItems = items.start();
		items.cancel();
		const latestItems = items.start();
		expect(page.isCurrent()).toBe(true);
		expect(firstItems.isCurrent()).toBe(false);
		expect(latestItems.isCurrent()).toBe(true);
	});
});
