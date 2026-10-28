import { AsyncLocalStorage } from "node:async_hooks";
import type { IpAddress, RequestId, UserId } from "./types";

export interface RequestStore {
	requestId: RequestId;
	ip: IpAddress;
	userId: UserId | null;
	startedAt: number;
}

const als = new AsyncLocalStorage<RequestStore>();

let counter = 0;

function generateRequestId(): RequestId {
	counter = (counter + 1) & 0xffff;
	return `${Date.now().toString(36)}-${counter.toString(36)}-${crypto.randomUUID().slice(0, 8)}` as RequestId;
}

export function createStore(ip: IpAddress): RequestStore {
	return {
		requestId: generateRequestId(),
		ip,
		userId: null,
		startedAt: Date.now(),
	};
}

export function runWithStore<T>(store: RequestStore, fn: () => T): T {
	return als.run(store, fn);
}

export function getRequestId(): RequestId {
	return als.getStore()?.requestId ?? generateRequestId();
}

export function setContextUserId(userId: UserId): void {
	const store = als.getStore();
	if (store) store.userId = userId;
}

/** Stable correlation data exists only inside an active request or job. */
export function getOperationContext(): {
	operationId?: string;
	userId?: number;
} {
	const store = als.getStore();
	return store
		? {
				operationId: store.requestId,
				...(store.userId === null ? {} : { userId: Number(store.userId) }),
			}
		: {};
}
