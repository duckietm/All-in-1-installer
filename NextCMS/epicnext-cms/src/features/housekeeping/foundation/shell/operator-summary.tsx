import type { HousekeepingActor } from "../contracts";

interface OperatorSummaryProps {
	actor: HousekeepingActor;
}

export function OperatorSummary({ actor }: OperatorSummaryProps) {
	return (
		<div className="min-w-0 text-sm text-[var(--admin-text)]">
			<div className="truncate font-medium">{actor.username}</div>
			<div
				data-operator-rank={actor.rank}
				className="text-[var(--admin-text-muted)]"
			>
				{actor.rank}
			</div>
		</div>
	);
}
