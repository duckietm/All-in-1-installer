"use client";

import { useEffect, useState } from "react";
import { reportBrowserError } from "@/lib/browser-errors";

/**
 * Last-resort boundary for errors thrown in the root layout itself. It replaces
 * the whole document, so it must render its own <html>/<body> and can't rely on
 * the app shell or CSS variables from globals.css.
 */
export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const [reference, setReference] = useState(error.digest);
	useEffect(() => {
		setReference(error.digest ?? reportBrowserError(error, "browser.boundary"));
		if (error.digest) reportBrowserError(error, "browser.boundary");
	}, [error]);

	return (
		<html lang="en">
			<body
				style={{
					margin: 0,
					minHeight: "100vh",
					display: "grid",
					placeItems: "center",
					padding: "1.5rem",
					fontFamily: 'Nunito, ui-rounded, "Segoe UI", system-ui, sans-serif',
					background:
						"radial-gradient(ellipse 80% 60% at 50% -10%, rgba(238, 180, 37, 0.22), transparent 55%), linear-gradient(165deg, #141821 0%, #0c0e14 45%, #10141c 100%)",
					color: "#f3f4f6",
				}}
			>
				<style>{`
					@keyframes error-rise {
						from { opacity: 0; transform: translateY(12px); }
						to { opacity: 1; transform: translateY(0); }
					}
					.ge-panel {
						animation: error-rise 0.45s ease-out both;
						width: min(100%, 26rem);
						text-align: center;
						padding: 2.25rem 1.75rem;
						border-radius: 1.25rem;
						border: 1px solid rgba(238, 180, 37, 0.22);
						background: linear-gradient(
							180deg,
							rgba(255, 255, 255, 0.06),
							rgba(255, 255, 255, 0.02)
						);
						box-shadow:
							0 24px 48px rgba(0, 0, 0, 0.35),
							inset 0 1px 0 rgba(255, 255, 255, 0.06);
					}
					.ge-code {
						margin: 0 0 0.75rem;
						font-family: "Pixelify Sans", "Courier New", monospace;
						font-size: clamp(2.5rem, 8vw, 3.5rem);
						font-weight: 700;
						letter-spacing: 0.08em;
						line-height: 1;
						color: #eeb425;
						text-shadow: 0 0 40px rgba(238, 180, 37, 0.35);
					}
					.ge-title {
						margin: 0 0 0.5rem;
						font-size: 1.35rem;
						font-weight: 800;
					}
					.ge-body {
						margin: 0 0 1.5rem;
						color: #9ca3af;
						font-size: 0.95rem;
						line-height: 1.55;
					}
					.ge-btn {
						appearance: none;
						border: none;
						border-radius: 0.65rem;
						padding: 0.65rem 1.35rem;
						font: inherit;
						font-weight: 800;
						cursor: pointer;
						background: #eeb425;
						color: #1a1a2e;
						transition: transform 0.15s ease, filter 0.15s ease;
					}
					.ge-btn:hover { filter: brightness(1.05); transform: translateY(-1px); }
					.ge-btn:active { transform: translateY(0); }
					.ge-digest {
						margin: 1.25rem 0 0;
						font-size: 0.72rem;
						color: #6b7280;
						font-variant-numeric: tabular-nums;
						word-break: break-all;
					}
				`}</style>
				<div className="ge-panel" role="alert">
					<p className="ge-code">Error</p>
					<h1 className="ge-title">Something went wrong</h1>
					<p className="ge-body">
						The hotel ran into an unexpected error. Please try again — if it
						keeps happening, contact staff.
					</p>
					<button type="button" className="ge-btn" onClick={() => reset()}>
						Try again
					</button>
					{reference ? (
						<p className="ge-digest">Reference: {reference}</p>
					) : null}
				</div>
			</body>
		</html>
	);
}
