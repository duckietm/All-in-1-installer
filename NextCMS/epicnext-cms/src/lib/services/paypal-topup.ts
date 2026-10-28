export interface PendingTopup {
	userId: number;
	status: string | null;
	amount?: number;
}

export type AuthorizedTopup = PendingTopup & {
	action: "CAPTURE" | "DELIVER_CREDITS";
};

export type FindTopupOrder = (orderId: string) => Promise<PendingTopup | null>;

export interface CreatedTopupRecord {
	userId: number;
	transactionId: string;
	status: "CREATED";
	description: string;
	amount: number;
	currency: string;
	createdAt: Date;
	updatedAt: Date;
}

export type CreateTopupRecord = (data: CreatedTopupRecord) => Promise<unknown>;

export class TopupCaptureError extends Error {
	constructor(
		public readonly code: "ORDER_NOT_FOUND" | "ORDER_ALREADY_PROCESSED",
	) {
		super(code);
	}
}

export class TopupDeliveryError extends Error {
	readonly code = "DELIVERY_ALREADY_CLAIMED";

	constructor() {
		super("DELIVERY_ALREADY_CLAIMED");
	}
}

export async function claimTopupDelivery(
	claim: () => Promise<{ count: number }>,
): Promise<void> {
	const result = await claim();
	if (result.count !== 1) throw new TopupDeliveryError();
}

export async function authorizeTopupCapture(
	userId: number,
	orderId: string,
	findOrder: FindTopupOrder,
): Promise<AuthorizedTopup> {
	const order = await findOrder(orderId);
	if (!order || order.userId !== userId) {
		throw new TopupCaptureError("ORDER_NOT_FOUND");
	}
	if (
		order.status === "CAPTURED_PENDING_CREDIT" &&
		Number.isFinite(order.amount)
	) {
		return { ...order, action: "DELIVER_CREDITS" };
	}
	if (order.status !== "CREATED") {
		throw new TopupCaptureError("ORDER_ALREADY_PROCESSED");
	}
	return { ...order, action: "CAPTURE" };
}

export async function recordCreatedTopup(
	topup: {
		userId: number;
		orderId: string;
		amount: number;
		currency: string;
		credits: number;
	},
	createRecord: CreateTopupRecord,
): Promise<void> {
	const now = new Date();
	await createRecord({
		userId: topup.userId,
		transactionId: topup.orderId,
		status: "CREATED",
		description: `Top-up: ${topup.credits} credits`,
		amount: topup.amount,
		currency: topup.currency,
		createdAt: now,
		updatedAt: now,
	});
}
