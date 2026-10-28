import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sessionUserId } from "@/lib/auth/session-user";
import { db, WebsitePaypalTransactions } from "@/lib/db";
import { resolveHotelName } from "@/lib/hotel-name";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { logServerError } from "@/lib/server-log";
import {
	type CaptureResult,
	captureOrder,
	creditsPerUnit,
	isPayPalConfigured,
} from "@/lib/services/paypal";
import {
	type AuthorizedTopup,
	authorizeTopupCapture,
	claimTopupDelivery,
	TopupCaptureError,
} from "@/lib/services/paypal-topup";
import { rcon } from "@/lib/services/rcon";
import { currencyDb, sendCurrency } from "@/lib/services/send-currency";

/**
 * POST /cms_api/paypal/capture — capture an approved order and credit the buyer.
 * Body: { orderId: string } (PayPal order id from /cms_api/paypal/create).
 *
 * On a COMPLETED capture we:
 *   1. record the payment in website_paypal_transactions (idempotent on
 *      transaction_id so a double-submit can't double-credit), and
 *   2. credit the buyer's `credits` wallet via sendCurrency (RCON-first, DB
 *      fallback). NOTE: the schema has no dedicated website-balance column —
 *      User.credits is the website/in-game wallet, so the top-up lands there,
 *      consistent with the voucher redeem flow.
 *
 * Auth-gated via auth(); the crediting user id is the session user, not a body
 * field, so a captured order always credits the person who is signed in.
 */
export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return NextResponse.json(
			{ error: "You must be signed in." },
			{ status: 401 },
		);
	}
	const userId = sessionUserId(session.user.id);
	if (!userId) {
		return NextResponse.json({ error: "Invalid session." }, { status: 401 });
	}

	if (!(await rateLimit(`paypal-capture:${userId}`, 5, 60_000)).ok) {
		return NextResponse.json(
			{ error: "Too many capture requests. Please wait a minute." },
			{ status: 429 },
		);
	}

	if (!isPayPalConfigured()) {
		return NextResponse.json(
			{
				error:
					"PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_SECRET.",
			},
			{ status: 503 },
		);
	}

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
	}

	const orderId = String((body as { orderId?: unknown })?.orderId ?? "").trim();
	if (!orderId) {
		return NextResponse.json({ error: "Missing orderId." }, { status: 422 });
	}

	// The create endpoint records ownership before returning the approval URL.
	// Do not let a signed-in user submit somebody else's approved order id.
	let authorized: AuthorizedTopup;
	try {
		authorized = await authorizeTopupCapture(
			userId,
			orderId,
			async (transactionId) => {
				const [row] = await db
					.select({
						userId: WebsitePaypalTransactions.userId,
						status: WebsitePaypalTransactions.status,
						amount: WebsitePaypalTransactions.amount,
					})
					.from(WebsitePaypalTransactions)
					.where(eq(WebsitePaypalTransactions.transactionId, transactionId))
					.limit(1);
				return row ?? null;
			},
		);
	} catch (error) {
		if (error instanceof TopupCaptureError) {
			const status = error.code === "ORDER_NOT_FOUND" ? 404 : 409;
			return NextResponse.json(
				{ error: "Order not found or already processed." },
				{ status },
			);
		}
		return NextResponse.json(
			{ error: "Could not verify the payment order." },
			{ status: 500 },
		);
	}

	if (authorized.action === "DELIVER_CREDITS") {
		const amount = authorized.amount ?? 0;
		const credits = Math.floor(amount * creditsPerUnit());
		try {
			await claimTopupDelivery(async () => {
				const [result] = await db
					.update(WebsitePaypalTransactions)
					.set({ status: "CREDIT_DELIVERING", updatedAt: new Date() })
					.where(
						and(
							eq(WebsitePaypalTransactions.userId, userId),
							eq(WebsitePaypalTransactions.transactionId, orderId),
							eq(WebsitePaypalTransactions.status, "CAPTURED_PENDING_CREDIT"),
						),
					);
				return { count: result.affectedRows };
			});
			await sendCurrency({ rcon, db: currencyDb }, userId, "credits", credits);
			await db
				.update(WebsitePaypalTransactions)
				.set({ status: "COMPLETED", updatedAt: new Date() })
				.where(
					and(
						eq(WebsitePaypalTransactions.userId, userId),
						eq(WebsitePaypalTransactions.transactionId, orderId),
						eq(WebsitePaypalTransactions.status, "CREDIT_DELIVERING"),
					),
				);
			return NextResponse.json({
				ok: true,
				recovered: true,
				status: "COMPLETED",
				amount,
				credits,
			});
		} catch (error) {
			logServerError("paypal.credit_recovery_failed", error, {
				userId,
				orderId,
			});
			return NextResponse.json(
				{
					error:
						"Payment is recorded but credits could not be delivered. Contact staff.",
				},
				{ status: 500 },
			);
		}
	}

	let result: CaptureResult;
	try {
		result = await captureOrder(orderId);
	} catch (e) {
		logger.error("PayPal capture failed", {
			module: "paypal/capture",
			error: (e as Error).message,
		});
		return NextResponse.json(
			{
				error:
					"Could not capture the PayPal payment. If you were charged, contact staff.",
			},
			{ status: 502 },
		);
	}

	const hotelName = await resolveHotelName();

	if (result.status !== "COMPLETED") {
		// Record the non-completed attempt so support can trace it.
		try {
			await db
				.update(WebsitePaypalTransactions)
				.set({
					status: result.status,
					description: `${hotelName} top-up (not completed)`,
					amount: result.amount,
					currency: result.currency,
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(WebsitePaypalTransactions.userId, userId),
						eq(WebsitePaypalTransactions.transactionId, orderId),
						eq(WebsitePaypalTransactions.status, "CREATED"),
					),
				);
		} catch {
			/* best-effort logging */
		}
		return NextResponse.json(
			{ ok: false, status: result.status, error: "Payment was not completed." },
			{ status: 402 },
		);
	}

	const credits = Math.floor(result.amount * creditsPerUnit());

	// Record the transaction BEFORE crediting so a crash mid-grant can't be
	// reprocessed into a double credit (the idempotency check above keys on this).
	try {
		const [claimed] = await db
			.update(WebsitePaypalTransactions)
			.set({
				status: "CAPTURED_PENDING_CREDIT",
				description: `${hotelName} top-up: ${credits} credits`,
				amount: result.amount,
				currency: result.currency,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(WebsitePaypalTransactions.userId, userId),
					eq(WebsitePaypalTransactions.transactionId, orderId),
					eq(WebsitePaypalTransactions.status, "CREATED"),
				),
			);
		if (claimed.affectedRows !== 1)
			throw new Error("Top-up order was already claimed");
	} catch (e) {
		logger.error("PayPal capture record failed", {
			module: "paypal/capture",
			error: (e as Error).message,
		});
		return NextResponse.json(
			{
				error:
					"Payment captured but could not be recorded. Contact staff with your order id.",
			},
			{ status: 500 },
		);
	}

	// Atomically claim delivery so concurrent retries cannot grant twice. If the
	// external delivery outcome is ambiguous, CREDIT_DELIVERING remains visible
	// for staff reconciliation instead of automatically risking a second grant.
	try {
		await claimTopupDelivery(async () => {
			const [claimResult] = await db
				.update(WebsitePaypalTransactions)
				.set({ status: "CREDIT_DELIVERING", updatedAt: new Date() })
				.where(
					and(
						eq(WebsitePaypalTransactions.userId, userId),
						eq(WebsitePaypalTransactions.transactionId, orderId),
						eq(WebsitePaypalTransactions.status, "CAPTURED_PENDING_CREDIT"),
					),
				);
			return { count: claimResult.affectedRows };
		});
		await sendCurrency({ rcon, db: currencyDb }, userId, "credits", credits);
		await db
			.update(WebsitePaypalTransactions)
			.set({ status: "COMPLETED", updatedAt: new Date() })
			.where(
				and(
					eq(WebsitePaypalTransactions.userId, userId),
					eq(WebsitePaypalTransactions.transactionId, orderId),
					eq(WebsitePaypalTransactions.status, "CREDIT_DELIVERING"),
				),
			);
	} catch (e) {
		logger.error("PayPal capture credit failed", {
			module: "paypal/capture",
			error: (e as Error).message,
		});
		return NextResponse.json(
			{
				ok: false,
				error:
					"Payment recorded but credits could not be delivered. Contact staff.",
			},
			{ status: 500 },
		);
	}

	return NextResponse.json({
		ok: true,
		status: "COMPLETED",
		amount: result.amount,
		currency: result.currency,
		credits,
	});
}
