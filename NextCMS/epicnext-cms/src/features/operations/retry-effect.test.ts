// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { execute } }));

import { retryEffect } from "./server";

const id = "840f4023-04cd-4d7b-92c5-047aa620029c";
beforeEach(() => vi.resetAllMocks());
it("does not report a missing or no-longer-failed delivery as retried", async () => {
	execute.mockResolvedValue([{ affectedRows: 0 }]);
	await expect(retryEffect(id)).rejects.toThrow("no longer available");
});
it("accepts a delivery that was actually moved back to pending", async () => {
	execute.mockResolvedValue([{ affectedRows: 1 }]);
	await expect(retryEffect(id)).resolves.toBeUndefined();
});
it("rejects malformed identifiers before a database query", async () => {
	await expect(
		retryEffect("------------------------------------"),
	).rejects.toThrow("Invalid delivery");
	expect(execute).not.toHaveBeenCalled();
});
