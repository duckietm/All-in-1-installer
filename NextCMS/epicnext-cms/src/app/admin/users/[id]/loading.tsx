import { Skeleton } from "@/components/ui/skeleton";

export default function UserDetailLoading() {
	return (
		<div className="space-y-6">
			{/* Breadcrumb */}
			<div className="flex items-center gap-2">
				<Skeleton className="h-4 w-16" />
				<Skeleton className="h-4 w-4" />
				<Skeleton className="h-4 w-24" />
			</div>

			{/* User header */}
			<div className="flex items-center gap-4">
				<Skeleton className="h-16 w-16 rounded" />
				<div>
					<Skeleton className="h-9 w-40" />
					<div className="flex items-center gap-2 mt-1">
						<Skeleton className="h-5 w-16 rounded-full" />
						<Skeleton className="h-5 w-16 rounded-full" />
					</div>
				</div>
			</div>

			<div className="grid gap-6 lg:grid-cols-2">
				{/* Form */}
				<div className="rounded-lg border bg-card p-6 space-y-4">
					<Skeleton className="h-6 w-24" />
					{Array.from({ length: 6 }, (_, i) => i).map((n) => (
						<div key={`skeleton-field-${n}`} className="space-y-2">
							<Skeleton className="h-4 w-20" />
							<Skeleton className="h-10 w-full" />
						</div>
					))}
					<Skeleton className="h-10 w-24 mt-4" />
				</div>

				{/* Side cards */}
				<div className="space-y-6">
					{Array.from({ length: 3 }, (_, i) => i).map((n) => (
						<div
							key={`skeleton-card-${n}`}
							className="rounded-lg border bg-card p-6 space-y-3"
						>
							<Skeleton className="h-6 w-32" />
							<Skeleton className="h-20 w-full" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
