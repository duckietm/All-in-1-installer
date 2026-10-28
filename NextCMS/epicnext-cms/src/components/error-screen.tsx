import type { ReactNode } from "react";

/**
 * Shared public error / empty-route composition.
 * Used by route error.tsx and not-found.tsx (inside the app shell).
 */
export function ErrorScreen({
	code,
	title,
	subtitle,
	body,
	actions,
	footer,
}: {
	code: string;
	title: string;
	subtitle: string;
	body: string;
	actions: ReactNode;
	footer?: ReactNode;
}) {
	return (
		<main className="error-screen">
			<div className="error-screen-glow" aria-hidden />
			<section
				className="error-screen-panel"
				aria-labelledby="error-screen-title"
			>
				<p className="error-screen-code">{code}</p>
				<h1 id="error-screen-title" className="error-screen-title">
					{title}
				</h1>
				<p className="error-screen-subtitle">{subtitle}</p>
				<p className="error-screen-body">{body}</p>
				<div className="error-screen-actions">{actions}</div>
				{footer ? <div className="error-screen-footer">{footer}</div> : null}
			</section>
		</main>
	);
}
