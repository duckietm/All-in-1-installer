"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ChartDataPoint {
	label: string;
	value: number;
}

export function DashboardChart({
	title,
	data,
	description,
}: {
	title: string;
	data: ChartDataPoint[];
	color?: string;
	description?: string;
}) {
	const max = Math.max(1, ...data.map((point) => point.value));
	return (
		<Card>
			<CardHeader className="pb-2">
				<CardTitle className="text-sm font-medium">{title}</CardTitle>
				{description && (
					<p className="text-xs text-muted-foreground">{description}</p>
				)}
			</CardHeader>
			<CardContent>
				<div
					className="flex h-[200px] items-end gap-1"
					aria-label={title}
					role="img"
				>
					{data.map((point) => (
						<div
							key={point.label}
							className="flex min-w-0 flex-1 flex-col items-center gap-1"
						>
							<span className="text-[10px] text-muted-foreground">
								{point.value}
							</span>
							<div
								className="w-full rounded-t bg-[var(--admin-accent)]"
								style={{
									height: `${Math.max(2, (point.value / max) * 150)}px`,
								}}
								title={`${point.label}: ${point.value}`}
							/>
							<span className="max-w-full truncate text-[9px] text-muted-foreground">
								{point.label}
							</span>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}
