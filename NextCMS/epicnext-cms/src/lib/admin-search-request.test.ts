// @ts-nocheck
import { describe, expect, it } from "vitest";
import { AdminSearchRequest } from "./admin-search-request";

describe("admin search request ownership", () => {
	it("rejects a late response after the input changes, even before the next debounce fires", async () => {
		const requests = new AdminSearchRequest();
		const first = requests.start();
		const late = Promise.resolve().then(() => requests.accepts(first));
		requests.cancel();
		expect(await late).toBe(false);
		expect(first.signal.aborted).toBe(true);
	});
	it("accepts only the newest request and rejects completion after closing", () => {
		const requests = new AdminSearchRequest();
		const first = requests.start();
		const second = requests.start();
		expect(requests.accepts(first)).toBe(false);
		expect(requests.accepts(second)).toBe(true);
		requests.cancel();
		expect(requests.accepts(second)).toBe(false);
	});
});
