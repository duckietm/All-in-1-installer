// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
	authorizeTopupCapture,
	claimTopupDelivery,
	recordCreatedTopup,
} from "@/lib/services/paypal-topup";

describe("authorizeTopupCapture", () => {
	it("rejects an order created by a different user", async () => {
		const findOrder = async () => ({
			userId: 41,
			status: "CREATED",
		});

		await expect(
			authorizeTopupCapture(99, "ORDER-123", findOrder),
		).rejects.toMatchObject({
			code: "ORDER_NOT_FOUND",
		});
	});

	it("rejects an order that has already left the created state", async () => {
		const findOrder = async () => ({
			userId: 99,
			status: "COMPLETED",
		});

		await expect(
			authorizeTopupCapture(99, "ORDER-123", findOrder),
		).rejects.toMatchObject({
			code: "ORDER_ALREADY_PROCESSED",
		});
	});

	it("resumes credit delivery for a captured order without capturing it again", async () => {
		const findOrder = async () => ({
			userId: 99,
			status: "CAPTURED_PENDING_CREDIT",
			amount: 12.5,
		});

		await expect(
			authorizeTopupCapture(99, "ORDER-123", findOrder),
		).resolves.toMatchObject({
			action: "DELIVER_CREDITS",
			amount: 12.5,
		});
	});
});

describe("recordCreatedTopup", () => {
	it("stores the PayPal order id with its owner before approval", async () => {
		let saved: Parameters<typeof record>[0] | undefined;
		const record = async (data: {
			userId: number;
			transactionId: string;
			status: string;
			description: string;
			amount: number;
			currency: string;
			createdAt: Date;
			updatedAt: Date;
		}) => {
			saved = data;
		};

		await recordCreatedTopup(
			{
				userId: 99,
				orderId: "ORDER-123",
				amount: 12.5,
				currency: "EUR",
				credits: 1250,
			},
			record,
		);

		expect(saved).toMatchObject({
			userId: 99,
			transactionId: "ORDER-123",
			status: "CREATED",
			amount: 12.5,
			currency: "EUR",
		});
	});
});

describe("claimTopupDelivery", () => {
	it("rejects delivery when another request already claimed the order", async () => {
		const claim = async () => ({ count: 0 });

		await expect(claimTopupDelivery(claim)).rejects.toMatchObject({
			code: "DELIVERY_ALREADY_CLAIMED",
		});
	});

	it("allows delivery after atomically claiming the pending order", async () => {
		const claim = async () => ({ count: 1 });

		await expect(claimTopupDelivery(claim)).resolves.toBeUndefined();
	});
});
