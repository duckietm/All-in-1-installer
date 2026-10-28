import { Skeleton } from "@/components/ui/skeleton";

export default function UsersLoading() {
	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<Skeleton className="h-9 w-32" />
					<Skeleton className="h-5 w-56 mt-2" />
				</div>
				<Skeleton className="h-10 w-28" />
			</div>

			{/* Toolbar */}
			<div className="flex items-center gap-3">
				<Skeleton className="h-10 w-64" />
				<Skeleton className="h-10 w-24" />
				<Skeleton className="h-10 w-[100px]" />
			</div>

			{/* Table */}
			<div className="rounded-md border">
				<div className="border-b px-4 py-3">
					<div className="flex gap-8">
						{Array.from({ length: 6 }, (_, i) => i).map((n) => (
							<Skeleton key={`skeleton-header-${n}`} className="h-4 w-20" />
						))}
					</div>
				</div>
				{Array.from({ length: 10 }, (_, i) => i).map((n) => (
					<div
						key={`skeleton-row-${n}`}
						className="flex items-center gap-8 px-4 py-3 border-b last:border-0"
					>
						<Skeleton className="h-4 w-10" />
						<div className="flex items-center gap-2">
							<Skeleton className="h-8 w-8 rounded" />
							<Skeleton className="h-4 w-24" />
						</div>
						<Skeleton className="h-4 w-36" />
						<Skeleton className="h-5 w-14 rounded-full" />
						<Skeleton className="h-4 w-16" />
						<Skeleton className="h-5 w-14 rounded-full" />
					</div>
				))}
			</div>
		</div>
	);
}
