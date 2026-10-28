import { createHash } from "node:crypto";
export interface OperationInput {
	actorId: number;
	kind: string;
	key: string;
	input: unknown;
}
export class OperationConflict extends Error {
	constructor() {
		super(
			"This request key was already used for different changes. Refresh the preview.",
		);
	}
}
export function validateOperation(value: OperationInput) {
	if (
		!Number.isSafeInteger(value.actorId) ||
		value.actorId < 1 ||
		!/^[a-z][a-z0-9.-]{2,63}$/.test(value.kind) ||
		!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
			value.key,
		)
	)
		throw new Error("Invalid operation identity");
}
function canonical(value: unknown, depth = 0): unknown {
	if (depth > 30) throw new Error("Operation input is too deep");
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (Array.isArray(value)) return value.map((v) => canonical(v, depth + 1));
	if (
		value &&
		typeof value === "object" &&
		Object.getPrototypeOf(value) === Object.prototype
	)
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [
					key,
					canonical((value as Record<string, unknown>)[key], depth + 1),
				]),
		);
	throw new Error("Unsupported operation input");
}
export function operationHash(value: unknown) {
	const serialized = JSON.stringify(canonical(value));
	if (Buffer.byteLength(serialized) > 65536)
		throw new Error("Operation input is too large");
	return createHash("sha256").update(serialized).digest("hex");
}
export function retryDelay(attempt: number) {
	return Math.min(3600, 60 * 2 ** Math.max(0, attempt - 1));
}
export type EffectTopic =
	| "catalog.refresh"
	| "catalog.export.request"
	| "news.refresh";
export interface EffectClaim {
	id: string;
	operationId?: string;
	token: string;
	topic: EffectTopic;
	attempts: number;
}
