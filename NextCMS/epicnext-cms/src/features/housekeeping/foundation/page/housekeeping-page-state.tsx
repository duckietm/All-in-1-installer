import type { ReactNode } from "react";

interface HousekeepingPageStateBaseProps {
	title: string;
	description: string;
	retryAction?: ReactNode;
}

type HousekeepingPageStateProps = HousekeepingPageStateBaseProps &
	(
		| { state: "partial"; partialLabel: string }
		| { state: "loading" | "empty" | "error"; partialLabel?: never }
	);

export function HousekeepingPageState({
	state,
	partialLabel,
	title,
	description,
	retryAction,
}: HousekeepingPageStateProps) {
	const isError = state === "error";
	const isPartial = state === "partial";

	return (
		<section
			role={isError ? "alert" : "status"}
			aria-live={state === "loading" ? "polite" : undefined}
			className={`rounded-lg border p-4 ${
				isError
					? "border-[var(--admin-error)] bg-[var(--admin-surface)]"
					: isPartial
						? "border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)]"
						: "border-[var(--admin-border)] bg-[var(--admin-surface)]"
			}`}
		>
			{isPartial ? (
				<p
					data-state-tone="warning"
					className="mb-2 inline-flex rounded-full border border-[var(--admin-warning-border)] bg-[var(--admin-surface)] px-2 py-0.5 text-xs font-medium text-[var(--admin-warning)]"
				>
					{partialLabel}
				</p>
			) : null}
			<h2 className="font-medium text-[var(--admin-text)]">{title}</h2>
			<p className="mt-1 text-sm text-[var(--admin-text-muted)]">
				{description}
			</p>
			{retryAction ? <div className="mt-3">{retryAction}</div> : null}
		</section>
	);
}
