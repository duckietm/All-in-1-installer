import { Skeleton } from "@/components/ui/skeleton";

export default function CatalogLoading() {
	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<Skeleton className="h-9 w-48" />
					<Skeleton className="h-5 w-64 mt-2" />
				</div>
				<div className="flex items-center gap-2">
					<Skeleton className="h-10 w-24" />
					<Skeleton className="h-10 w-28" />
				</div>
			</div>

			{/* Tree skeleton */}
			<div className="rounded-lg border bg-card">
				<div className="border-b px-4 py-3 flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Skeleton className="h-4 w-4" />
						<Skeleton className="h-4 w-32" />
						<Skeleton className="h-5 w-16 rounded-full" />
					</div>
					<Skeleton className="h-8 w-56" />
				</div>
				<div className="p-2 space-y-1">
					{Array.from({ length: 12 }, (_, i) => i).map((n) => (
						<div
							key={`skeleton-tree-${n}`}
							className="flex items-center gap-2 px-2 py-1.5"
							style={{ paddingLeft: `${(n % 3) * 20 + 8}px` }}
						>
							<Skeleton className="h-5 w-5 shrink-0" />
							<Skeleton className="h-5 w-5 shrink-0" />
							<Skeleton className="h-4 flex-1 max-w-48" />
							<Skeleton className="h-5 w-8 rounded-full" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
