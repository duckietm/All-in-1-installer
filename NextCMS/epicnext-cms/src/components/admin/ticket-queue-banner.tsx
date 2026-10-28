import Link from "@/components/link";

/** Shared clarity banner for dual ticket products (CMS desk vs help-center). */
export function TicketQueueBanner({
	hint,
	otherHref,
	otherLabel,
	countsLine,
}: {
	hint: string;
	otherHref: string;
	otherLabel: string;
	/** Optional preformatted open-count summary (locale-aware from caller). */
	countsLine?: string;
}) {
	return (
		<div
			className="rounded-lg border border-[var(--admin-info-border)] bg-[var(--admin-info-subtle)] px-4 py-3 text-sm"
			role="status"
		>
			<p className="m-0">{hint}</p>
			{countsLine ? (
				<p className="m-0 mt-1 text-muted-foreground">{countsLine}</p>
			) : null}
			<p className="m-0 mt-1">
				<Link
					href={otherHref}
					className="font-medium text-[var(--admin-accent)] underline-offset-2 hover:underline"
				>
					{otherLabel}
				</Link>
			</p>
		</div>
	);
}
