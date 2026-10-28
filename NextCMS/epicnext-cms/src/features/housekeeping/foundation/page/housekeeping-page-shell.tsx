import type { ReactNode } from "react";

interface HousekeepingPageShellProps {
	title: string;
	description: string;
	primaryAction?: ReactNode;
	context?: ReactNode;
	children: ReactNode;
}

export function HousekeepingPageShell({
	title,
	description,
	primaryAction,
	context,
	children,
}: HousekeepingPageShellProps) {
	return (
		<section className="space-y-6">
			<header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--admin-border)] pb-4">
				<div className="min-w-0 space-y-1">
					<h1 className="text-xl font-semibold text-[var(--admin-text)]">
						{title}
					</h1>
					<p className="text-sm text-[var(--admin-text-muted)]">
						{description}
					</p>
					{context ? <div>{context}</div> : null}
				</div>
				{primaryAction ? <div>{primaryAction}</div> : null}
			</header>
			<div>{children}</div>
		</section>
	);
}
