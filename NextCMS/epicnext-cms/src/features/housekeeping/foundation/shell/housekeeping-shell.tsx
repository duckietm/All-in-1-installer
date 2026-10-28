import type { ReactNode } from "react";
import Link from "@/components/link";
import type { HousekeepingDomainId } from "../../migration/types";
import type { HousekeepingActor } from "../contracts";
import type { HousekeepingNavigationDomain } from "../navigation";
import { CommandTrigger } from "./command-trigger";
import { ContextNav } from "./context-nav";
import { DomainRail } from "./domain-rail";
import { OperatorSummary } from "./operator-summary";

interface HousekeepingShellProps {
	actor: HousekeepingActor;
	activeDomainId: HousekeepingDomainId;
	domains: readonly HousekeepingNavigationDomain[];
	labels: {
		skipToContent: string;
		primaryNavigation: string;
		contextualNavigation: string;
		command: string;
		preview: string;
		backToSite: string;
	};
	children: ReactNode;
}

export function HousekeepingShell({
	actor,
	activeDomainId,
	domains,
	labels,
	children,
}: HousekeepingShellProps) {
	const activeDomain = domains.find((domain) => domain.id === activeDomainId);

	return (
		<div className="min-h-screen bg-[var(--admin-canvas)] text-[var(--admin-text)]">
			<a
				href="#housekeeping-content"
				className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 rounded-md bg-[var(--admin-surface)] px-3 py-2 text-[var(--admin-text)]"
			>
				{labels.skipToContent}
			</a>
			<header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3">
				<div className="flex items-center gap-3">
					<span className="rounded-full border border-[var(--admin-border)] px-2 py-1 text-xs text-[var(--admin-accent)]">
						{labels.preview}
					</span>
					<OperatorSummary actor={actor} />
				</div>
				<div className="flex items-center gap-2">
					<CommandTrigger label={labels.command} />
					<Link
						href="/"
						className="rounded-md px-3 py-2 text-sm text-[var(--admin-text-muted)] hover:bg-[var(--admin-canvas)] hover:text-[var(--admin-text)]"
					>
						{labels.backToSite}
					</Link>
				</div>
			</header>
			<div className="flex min-h-[calc(100vh-4rem)] flex-col lg:flex-row">
				<aside className="border-b border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 lg:border-b-0 lg:border-r">
					<DomainRail
						domains={domains}
						activeDomainId={activeDomainId}
						ariaLabel={labels.primaryNavigation}
					/>
				</aside>
				<div className="border-b border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 lg:w-56 lg:border-b-0 lg:border-r">
					<ContextNav
						items={activeDomain?.items ?? []}
						ariaLabel={labels.contextualNavigation}
					/>
				</div>
				<main id="housekeeping-content" className="min-w-0 flex-1 p-4 lg:p-6">
					{children}
				</main>
			</div>
		</div>
	);
}
