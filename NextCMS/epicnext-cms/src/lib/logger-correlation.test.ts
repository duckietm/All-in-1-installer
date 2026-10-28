// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createStore,
	getOperationContext,
	runWithStore,
	setContextUserId,
} from "./foundation/request-context";
import type { IpAddress, UserId } from "./foundation/types";

const state = vi.hoisted(() => ({
	records: [] as { context: Record<string, unknown> }[],
}));
vi.mock("./error-monitor", async (original) => {
	const actual = await original<typeof import("./error-monitor")>();
	return {
		...actual,
		captureCmsError: (...args: Parameters<typeof actual.createErrorRecord>) => {
			const record = actual.createErrorRecord(...args);
			state.records.push(record);
			return record.id;
		},
	};
});

import { logger } from "./logger";

describe("logger correlation boundaries", () => {
	beforeEach(() => {
		state.records = [];
	});
	it("keeps trusted operation context when metadata is large or supplies conflicting IDs", () => {
		const store = createStore("test" as IpAddress);
		runWithStore(store, () => {
			setContextUserId(42 as UserId);
			logger.error("failed", {
				...Object.fromEntries(
					Array.from({ length: 30 }, (_, index) => [`field${index}`, index]),
				),
				operationId: "forged",
				userId: 99,
			});
		});
		expect(state.records[0].context).toMatchObject({
			operationId: store.requestId,
			userId: 42,
		});
		expect(getOperationContext()).toEqual({});
	});
});
