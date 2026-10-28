import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for any Catalog Studio sub-page. Mirrors the StudioPage
 * header (icon tile, title, subtitle) and a body block so navigation between
 * studio tools shows a stable skeleton instead of a blank pause.
 */
export default function StudioLoading() {
	return (
		<div className="p-4">
			<div className="space-y-5">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="flex min-w-0 items-center gap-3">
						<Skeleton className="h-10 w-10 shrink-0 rounded-xl bg-[var(--admin-accent)]/10" />
						<div className="min-w-0">
							<Skeleton className="h-8 w-48" />
							<Skeleton className="mt-2 h-4 w-72 max-w-full" />
						</div>
					</div>
				</div>
				<div className="space-y-3 rounded-xl border border-[var(--admin-border)] p-4">
					<Skeleton className="h-5 w-40" />
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-4 w-2/3" />
					<Skeleton className="h-9 w-32" />
				</div>
			</div>
		</div>
	);
}
