import { NextResponse } from "next/server";
import { env } from "@/env";
import { auth } from "@/lib/auth";
import { sessionUserId } from "@/lib/auth/session-user";
import { db, WebsitePaypalTransactions } from "@/lib/db";
import { resolveHotelName } from "@/lib/hotel-name";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import {
	createOrder,
	creditsPerUnit,
	isPayPalConfigured,
	PAYPAL_CURRENCY,
} from "@/lib/services/paypal";
import { recordCreatedTopup } from "@/lib/services/paypal-topup";

const MIN_AMOUNT = 1;
const MAX_AMOUNT = 500;

/**
 * POST /api/paypal/create — create a PayPal CAPTURE order for the signed-in user.
 * Body: { amount: number } (in the configured currency, default USD).
 * Returns { id, approveUrl } on success; a clear JSON error otherwise.
 *
 * Auth-gated via auth(): the order is tied to the session, never to a body field.
 */
export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return NextResponse.json(
			{ error: "You must be signed in to top up." },
			{ status: 401 },
		);
	}
	const userId = sessionUserId(session.user.id);
	if (!userId) {
		return NextResponse.json({ error: "Invalid session." }, { status: 401 });
	}

	if (!(await rateLimit(`paypal-create:${userId}`, 5, 60_000)).ok) {
		return NextResponse.json(
			{ error: "Too many top-up requests. Please wait a minute." },
			{ status: 429 },
		);
	}

	// Fail fast (and clearly) when the sandbox/live keys aren't set.
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

	const raw = (body as { amount?: unknown })?.amount;
	const amount = Math.round(Number(raw) * 100) / 100;
	if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
		return NextResponse.json(
			{
				error: `Enter an amount between ${MIN_AMOUNT} and ${MAX_AMOUNT} ${PAYPAL_CURRENCY}.`,
			},
			{ status: 422 },
		);
	}

	const credits = Math.floor(amount * creditsPerUnit());
	const base = env.APP_URL.replace(/\/+$/, "");
	const hotelName = await resolveHotelName();

	try {
		const order = await createOrder(amount, {
			description: `${hotelName} top-up: ${credits} credits`,
			returnUrl: `${base}/shop/topup?status=success`,
			cancelUrl: `${base}/shop/topup?status=cancel`,
		});

		if (!order.approveUrl) {
			return NextResponse.json(
				{ error: "PayPal did not return an approval link. Try again." },
				{ status: 502 },
			);
		}

		await recordCreatedTopup(
			{ userId, orderId: order.id, amount, currency: PAYPAL_CURRENCY, credits },
			(data) => db.insert(WebsitePaypalTransactions).values(data),
		);

		return NextResponse.json({
			id: order.id,
			approveUrl: order.approveUrl,
			amount,
			currency: PAYPAL_CURRENCY,
			credits,
		});
	} catch (e) {
		logger.error("PayPal create order failed", {
			module: "paypal/create",
			error: (e as Error).message,
		});
		return NextResponse.json(
			{ error: "Could not start the PayPal checkout. Please try again." },
			{ status: 502 },
		);
	}
}
