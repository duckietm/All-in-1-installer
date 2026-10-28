"use client";

import { useState } from "react";

/**
 * Client form for /shop/topup. Posts the chosen amount to /api/paypal/create,
 * then redirects the browser to PayPal's approval URL. After PayPal returns to
 * /shop/topup?token=<orderId>&status=success, it captures via /api/paypal/capture.
 */
export default function TopUpForm({
	currency,
	creditsPerUnit,
}: {
	currency: string;
	creditsPerUnit: number;
}) {
	const [amount, setAmount] = useState("5.00");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const numeric = Number(amount);
	const credits =
		Number.isFinite(numeric) && numeric > 0
			? Math.floor(numeric * creditsPerUnit)
			: 0;

	async function startCheckout(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setPending(true);
		try {
			const res = await fetch("/api/paypal/create", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ amount: numeric }),
			});
			const data = (await res.json().catch(() => ({}))) as {
				approveUrl?: string;
				error?: string;
			};
			if (!res.ok || !data.approveUrl) {
				setError(data.error ?? "Could not start the PayPal checkout.");
				setPending(false);
				return;
			}
			// Hand off to PayPal for approval.
			const redirectUrl = new URL(data.approveUrl);
			if (redirectUrl.protocol !== "https:") {
				throw new Error("Invalid redirect URL: must be HTTPS");
			}
			if (
				!redirectUrl.hostname.endsWith(".paypal.com") &&
				redirectUrl.hostname !== "paypal.com"
			) {
				throw new Error("Invalid redirect URL: must be a PayPal domain");
			}
			window.location.href = redirectUrl.href;
		} catch {
			setError("Network error — please try again.");
			setPending(false);
		}
	}

	async function capture(orderId: string) {
		setPending(true);
		setError(null);
		try {
			const res = await fetch("/api/paypal/capture", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ orderId }),
			});
			const data = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				credits?: number;
				error?: string;
			};
			if (res.ok && data.ok) {
				setSuccess(
					`Payment complete! ${(data.credits ?? 0).toLocaleString()} credits were added.`,
				);
			} else {
				setError(
					data.error ??
						"We couldn't confirm your payment. Contact staff if charged.",
				);
			}
		} catch {
			setError(
				"Network error confirming payment — contact staff if you were charged.",
			);
		} finally {
			setPending(false);
			// Clean the token/status query so a refresh doesn't re-capture.
			window.history.replaceState(null, "", "/shop/topup");
		}
	}

	// On return from PayPal (?token=<orderId>&status=success), auto-capture once.
	if (typeof window !== "undefined" && !pending && !success) {
		const params = new URLSearchParams(window.location.search);
		const token = params.get("token");
		if (token && params.get("status") === "success") {
			// Defer to avoid setState during render.
			queueMicrotask(() => capture(token));
		}
	}

	if (success) {
		return (
			<p
				role="status"
				aria-live="polite"
				style={{ margin: 0, fontWeight: 700, color: "var(--color-accent)" }}
			>
				{success}
			</p>
		);
	}

	return (
		<form
			onSubmit={startCheckout}
			style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
		>
			<label htmlFor="amount" style={{ fontWeight: 700 }}>
				Amount ({currency})
			</label>
			<input
				id="amount"
				name="amount"
				type="number"
				min={1}
				max={500}
				step={0.01}
				value={amount}
				onChange={(e) => setAmount(e.target.value)}
				aria-label={`Amount in ${currency}`}
				required
			/>
			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: "0.4rem",
				}}
			>
				{["2.00", "5.00", "10.00", "25.00"].map((v) => (
					<button
						key={v}
						type="button"
						className={`btn ${amount === v ? "btn-primary" : "btn-outline"}`}
						onClick={() => setAmount(v)}
					>
						{currency} {v}
					</button>
				))}
			</div>

			<p className="muted" style={{ margin: 0 }}>
				You&apos;ll receive <strong>{credits.toLocaleString()}</strong> credits.
			</p>

			<div>
				<button
					type="submit"
					className="btn btn-primary"
					disabled={pending || credits <= 0}
				>
					{pending ? "Redirecting…" : "Pay with PayPal"}
				</button>
			</div>

			{error ? (
				<p
					role="alert"
					aria-live="polite"
					style={{ margin: 0, fontWeight: 700, color: "var(--color-danger)" }}
				>
					{error}
				</p>
			) : null}
		</form>
	);
}
