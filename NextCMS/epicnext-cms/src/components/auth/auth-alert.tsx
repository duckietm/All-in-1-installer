"use client";

import type { ReactNode } from "react";

interface AuthAlertProps {
	children: ReactNode;
	/** Tint of the box: red for errors, green for confirmations. */
	variant?: "error" | "success";
	/** Extra classes, e.g. spacing (`mb-4`) or entrance animation. */
	className?: string;
	/** Optional id so inputs can point at the message via `aria-describedby`. */
	id?: string;
}

/**
 * The single status/error banner for the auth forms. Uses `role="alert"` for
 * failures (screen readers announce them immediately) and `role="status"` for
 * confirmations, so the two are wired correctly instead of every caller
 * repeating the markup and risking an unannounced message.
 */
export function AuthAlert({
	children,
	variant = "error",
	className = "",
	id,
}: AuthAlertProps) {
	return (
		<p
			id={id}
			role={variant === "error" ? "alert" : "status"}
			className={`auth-alert animate-fade-in-up m-0 ${
				variant === "success" ? "auth-alert--success" : ""
			} ${className}`}
		>
			{children}
		</p>
	);
}
