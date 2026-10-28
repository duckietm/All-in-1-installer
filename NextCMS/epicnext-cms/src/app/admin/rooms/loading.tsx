import { Skeleton } from "@/components/ui/skeleton";

export default function RoomsLoading() {
	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<Skeleton className="h-9 w-40" />
					<Skeleton className="h-5 w-64 mt-2" />
				</div>
			</div>
			<div className="flex items-center gap-3">
				<Skeleton className="h-10 w-64" />
				<Skeleton className="h-10 w-24" />
			</div>
			<div className="rounded-md border">
				{Array.from({ length: 8 }, (_, i) => i).map((n) => (
					<div
						key={`skeleton-row-${n}`}
						className="flex items-center gap-6 px-4 py-3 border-b last:border-0"
					>
						<Skeleton className="h-4 w-12" />
						<Skeleton className="h-4 w-32" />
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-5 w-16 rounded-full" />
					</div>
				))}
			</div>
		</div>
	);
}
