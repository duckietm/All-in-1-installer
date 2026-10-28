import { expect, it } from "vitest";
import {
	createStore,
	getOperationContext,
	runWithStore,
	setContextUserId,
} from "./request-context";
import type { IpAddress, UserId } from "./types";

it("isolates operation IDs and users across concurrent asynchronous requests", async () => {
	const first = createStore("test" as IpAddress),
		second = createStore("test" as IpAddress);
	expect(first.requestId).not.toBe(second.requestId);
	await Promise.all(
		[first, second].map((store, index) =>
			runWithStore(store, async () => {
				setContextUserId((index + 1) as UserId);
				await new Promise((resolve) => setTimeout(resolve, 5 - index));
				expect(getOperationContext()).toEqual({
					operationId: store.requestId,
					userId: index + 1,
				});
			}),
		),
	);
	expect(getOperationContext()).toEqual({});
});
