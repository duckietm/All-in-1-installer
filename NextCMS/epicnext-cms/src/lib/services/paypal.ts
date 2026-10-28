// PayPal v2 REST helper (Orders API) for the top-up flow. SDK-free: uses the
// global fetch only. Credentials and base URL come from env (see src/env.ts).

import { env } from "@/env";

export const PAYPAL_API =
	env.PAYPAL_API?.replace(/\/+$/, "") ?? "https://api-m.sandbox.paypal.com";

export const PAYPAL_CURRENCY = env.PAYPAL_CURRENCY.toUpperCase();

/** Credits granted per 1.00 of the order currency (configurable, sane default). */
export function creditsPerUnit(): number {
	const n = env.PAYPAL_CREDITS_PER_USD;
	return Number.isFinite(n) && n > 0 ? n : 100;
}

export class PayPalConfigError extends Error {}

function credentials(): { clientId: string; secret: string } {
	const clientId = env.PAYPAL_CLIENT_ID;
	const secret = env.PAYPAL_SECRET;
	if (!clientId || !secret) {
		throw new PayPalConfigError(
			"PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_SECRET.",
		);
	}
	// Without PAYPAL_API the sandbox is used: in production that would hand out real credits
	// for sandbox test payments. Set it explicitly (also to the sandbox, to test on purpose).
	if (env.NODE_ENV === "production" && !env.PAYPAL_API) {
		throw new PayPalConfigError(
			"Set PAYPAL_API (https://api-m.paypal.com for live payments) in production.",
		);
	}
	return { clientId, secret };
}

/** True when both PayPal credentials are present. */
export function isPayPalConfigured(): boolean {
	return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET);
}

/** OAuth2 client-credentials token (short-lived; we fetch one per request). */
async function getAccessToken(): Promise<string> {
	const { clientId, secret } = credentials();
	const basic = Buffer.from(`${clientId}:${secret}`).toString("base64");
	const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
		method: "POST",
		headers: {
			Authorization: `Basic ${basic}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: "grant_type=client_credentials",
		cache: "no-store",
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(
			`PayPal auth failed (${res.status}): ${body.slice(0, 300)}`,
		);
	}
	const json = (await res.json()) as { access_token?: string };
	if (!json.access_token)
		throw new Error("PayPal auth returned no access_token.");
	return json.access_token;
}

export interface CreatedOrder {
	id: string;
	approveUrl: string | null;
}

/**
 * Create a CAPTURE order for `amount` of the configured currency. Returns the
 * order id and the payer approval URL (rel === "approve") to redirect to.
 */
export async function createOrder(
	amount: number,
	opts: { description?: string; returnUrl?: string; cancelUrl?: string } = {},
): Promise<CreatedOrder> {
	const token = await getAccessToken();
	const value = amount.toFixed(2);

	const res = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		cache: "no-store",
		body: JSON.stringify({
			intent: "CAPTURE",
			purchase_units: [
				{
					amount: { currency_code: PAYPAL_CURRENCY, value },
					description: opts.description?.slice(0, 127),
				},
			],
			application_context: {
				shipping_preference: "NO_SHIPPING",
				user_action: "PAY_NOW",
				...(opts.returnUrl ? { return_url: opts.returnUrl } : {}),
				...(opts.cancelUrl ? { cancel_url: opts.cancelUrl } : {}),
			},
		}),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(
			`PayPal create order failed (${res.status}): ${body.slice(0, 300)}`,
		);
	}

	const json = (await res.json()) as {
		id: string;
		links?: { rel: string; href: string }[];
	};
	const approveUrl =
		json.links?.find((l) => l.rel === "approve" || l.rel === "payer-action")
			?.href ?? null;
	return { id: json.id, approveUrl };
}

export interface CaptureResult {
	id: string;
	status: string;
	amount: number;
	currency: string;
	/** The capture's own status: an order can be COMPLETED while its capture is PENDING (review, eCheck). */
	captureStatus: string | null;
	captureId: string | null;
	payerEmail: string | null;
}

/** Capture a previously-approved order id. */
export async function captureOrder(orderId: string): Promise<CaptureResult> {
	const token = await getAccessToken();
	const res = await fetch(
		`${PAYPAL_API}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			cache: "no-store",
		},
	);

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(
			`PayPal capture failed (${res.status}): ${body.slice(0, 300)}`,
		);
	}

	const json = (await res.json()) as {
		id: string;
		status: string;
		payer?: { email_address?: string };
		purchase_units?: {
			payments?: {
				captures?: {
					id: string;
					status?: string;
					amount?: { value?: string; currency_code?: string };
				}[];
			};
		}[];
	};

	const capture = json.purchase_units?.[0]?.payments?.captures?.[0];
	const amount = capture?.amount?.value ? Number(capture.amount.value) : 0;
	const currency = capture?.amount?.currency_code ?? PAYPAL_CURRENCY;

	return {
		id: json.id,
		status: json.status,
		amount,
		currency,
		captureStatus: capture?.status ?? null,
		captureId: capture?.id ?? null,
		payerEmail: json.payer?.email_address ?? null,
	};
}
