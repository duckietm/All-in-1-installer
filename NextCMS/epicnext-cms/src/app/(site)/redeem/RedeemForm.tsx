"use client";

import { useActionState } from "react";
import { type RedeemState, redeem } from "@/actions/voucher";

const initialState: RedeemState = null;

/**
 * Client form for /redeem. Uses useActionState so the redeem() server action's
 * feedback ({ ok, message }) can be rendered inline without a redirect.
 */
export default function RedeemForm() {
	const [state, formAction, pending] = useActionState(redeem, initialState);

	return (
		<form
			action={formAction}
			style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
		>
			<input
				name="code"
				maxLength={255}
				placeholder="Enter your voucher code"
				aria-label="Voucher code"
				autoComplete="off"
				required
			/>
			<div>
				<button type="submit" className="btn btn-primary" disabled={pending}>
					{pending ? "Redeeming…" : "Redeem voucher"}
				</button>
			</div>

			{state ? (
				<p
					role="status"
					aria-live="polite"
					style={{
						margin: "0.25rem 0 0",
						fontWeight: 700,
						color: state.ok
							? "var(--color-secondary-hover)"
							: "var(--color-danger)",
					}}
				>
					{state.message}
				</p>
			) : null}
		</form>
	);
}
