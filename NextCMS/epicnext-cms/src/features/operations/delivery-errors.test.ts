// @ts-nocheck
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/db", async () => ({
	...(await import("@/test/db-helpers")).createDbHelpers(mocks.execute),
	db: { execute: mocks.execute },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.error } }));

import { effectRepository, listEffects } from "./server";

const id = "840f4023-04cd-4d7b-92c5-047aa620029c";
const operationId = "1dd40f61-b710-48c8-8534-c3a3f726780a";
const errorId = "4f3df172-f1ca-4c26-a23e-cb4e6c13e9f2";
beforeEach(() => {
	vi.resetAllMocks();
	mocks.error.mockReturnValue(errorId);
	mocks.execute.mockResolvedValue([[]]);
});
it("records the original failure with durable identity and stores only a safe diagnostic reference", async () => {
	const error = new Error("private transport details");
	await effectRepository.fail(
		{
			id,
			operationId,
			token: "private-lease",
			topic: "news.refresh",
			attempts: 2,
		},
		error,
	);
	expect(mocks.error).toHaveBeenCalledWith(
		"Operation delivery failed",
		expect.objectContaining({
			module: "operations",
			deliveryId: id,
			durableOperationId: operationId,
			error,
		}),
	);
	const query = new MySqlDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
	expect(query.params).toContain(`Diagnostic reference: ${errorId}`);
	expect(query.params).not.toContain(error.message);
	expect(query.params).toContain("private-lease");
});
it("looks up an older delivery by exact ID independently of the latest-page limit", async () => {
	await listEffects(id);
	const query = new MySqlDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
	expect(query.sql).toContain("WHERE e.id=?");
	expect(query.params).toContain(id);
});
it("does not query the database for a malformed delivery reference", async () => {
	await expect(listEffects("../settings")).resolves.toEqual([]);
	expect(mocks.execute).not.toHaveBeenCalled();
});
