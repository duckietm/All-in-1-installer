import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, queryRows, rowsFrom } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isDeliveryReference } from "./delivery-diagnostics";
import {
	type EffectClaim,
	type EffectTopic,
	OperationConflict,
	type OperationInput,
	operationHash,
	retryDelay,
	validateOperation,
} from "./model";
export type OperationTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];
export async function runOperation<T>(
	input: OperationInput,
	work: (tx: OperationTransaction, operationId: string) => Promise<T>,
): Promise<T> {
	validateOperation(input);
	const hash = operationHash(input.input);
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`INSERT INTO cms_operations (id,actor_id,kind,request_key,request_hash) VALUES (${randomUUID()},${input.actorId},${input.kind},${input.key},${hash}) ON DUPLICATE KEY UPDATE id=id`,
		);
		const row = rowsFrom<{
			id: string;
			requestHash: string;
			resultJson: string | null;
		}>(
			await tx.execute(
				sql`SELECT id,request_hash AS requestHash,result_json AS resultJson FROM cms_operations WHERE actor_id=${input.actorId} AND kind=${input.kind} AND request_key=${input.key} FOR UPDATE`,
			),
		)[0];
		if (!row) throw new Error("Operation unavailable");
		if (row.requestHash !== hash) throw new OperationConflict();
		if (row.resultJson !== null) return JSON.parse(row.resultJson) as T;
		const result = await work(tx, row.id);
		const serialized = JSON.stringify(result);
		if (!serialized || Buffer.byteLength(serialized) > 1048576)
			throw new Error("Operation result exceeds storage limit");
		await tx.execute(
			sql`UPDATE cms_operations SET result_json=${serialized} WHERE id=${row.id}`,
		);
		return result;
	});
}
export async function enqueueEffect(
	tx: OperationTransaction,
	operationId: string,
	topic: EffectTopic,
) {
	await tx.execute(
		sql`INSERT INTO cms_outbox (id,operation_id,topic) VALUES (${randomUUID()},${operationId},${topic}) ON DUPLICATE KEY UPDATE id=id`,
	);
}
export const effectRepository = {
	async claim(): Promise<EffectClaim | null> {
		return db.transaction(async (tx) => {
			const row = rowsFrom<{
				id: string;
				operationId: string;
				topic: EffectTopic;
				attempts: number;
			}>(
				await tx.execute(
					sql`SELECT id,operation_id AS operationId,topic,attempts FROM cms_outbox WHERE (status='pending' AND available_at<=UTC_TIMESTAMP(3)) OR (status='running' AND lease_until<UTC_TIMESTAMP(3)) ORDER BY available_at,id LIMIT 1 FOR UPDATE`,
				),
			)[0];
			if (!row) return null;
			const token = randomUUID();
			await tx.execute(
				sql`UPDATE cms_outbox SET status='running',lease_token=${token},lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 120 SECOND),attempts=attempts+1 WHERE id=${row.id}`,
			);
			return { ...row, token, attempts: Number(row.attempts) + 1 };
		});
	},
	async complete(claim: EffectClaim) {
		await db.execute(
			sql`UPDATE cms_outbox SET status='done',lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=${claim.id} AND status='running' AND lease_token=${claim.token}`,
		);
	},
	async fail(claim: EffectClaim, error: unknown) {
		const errorId = logger.error("Operation delivery failed", {
			module: "operations",
			deliveryId: claim.id,
			durableOperationId: claim.operationId,
			topic: claim.topic,
			attempt: claim.attempts,
			error,
		});
		const reference = isDeliveryReference(errorId)
			? `Diagnostic reference: ${errorId}`
			: "Delivery failed; service diagnostics unavailable.";
		await db.execute(
			sql`UPDATE cms_outbox SET status=${claim.attempts >= 8 ? "failed" : "pending"},available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ${retryDelay(claim.attempts)} SECOND),lease_token=NULL,lease_until=NULL,last_error=${reference} WHERE id=${claim.id} AND status='running' AND lease_token=${claim.token}`,
		);
	},
};
export async function listEffects(id?: string) {
	if (id !== undefined && !isDeliveryReference(id)) return [];
	const filter = id === undefined ? sql`` : sql`WHERE e.id=${id}`;
	return queryRows<{
		id: string;
		operationId: string;
		topic: EffectTopic;
		status: string;
		attempts: number;
		lastError: string | null;
		createdAt: Date | string;
		availableAt: Date | string;
		resultJson: string | null;
		actorId: number;
		kind: string;
	}>(
		sql`SELECT e.id,e.operation_id AS operationId,e.topic,e.status,e.attempts,e.last_error AS lastError,e.created_at AS createdAt,e.available_at AS availableAt,o.actor_id AS actorId,o.kind,o.result_json AS resultJson FROM cms_outbox e JOIN cms_operations o ON o.id=e.operation_id ${filter} ORDER BY e.created_at DESC,e.id DESC LIMIT 100`,
	);
}
export async function retryEffect(id: string) {
	if (
		!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
	)
		throw new Error("Invalid delivery");
	const [result] = await db.execute(
		sql`UPDATE cms_outbox SET status='pending',attempts=0,available_at=UTC_TIMESTAMP(3),last_error=NULL WHERE id=${id} AND status='failed'`,
	);
	if (result.affectedRows !== 1)
		throw new Error("Delivery is no longer available for retry");
}
