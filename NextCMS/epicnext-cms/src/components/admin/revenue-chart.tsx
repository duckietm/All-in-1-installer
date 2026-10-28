"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RevenueDataPoint {
	label: string;
	credits: number;
	points: number;
}

export function RevenueChart({ data }: { data: RevenueDataPoint[] }) {
	const t = useTranslations("pages.admin.analytics.economy");
	const max = Math.max(
		1,
		...data.flatMap((point) => [point.credits, point.points]),
	);
	return (
		<Card>
			<CardHeader className="pb-2">
				<CardTitle className="text-sm font-medium">
					{t("catalogSpendingTitle")}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-3">
					{data.map((point) => (
						<div
							key={point.label}
							className="grid grid-cols-[3rem_1fr] items-center gap-2 text-xs"
						>
							<span>{point.label}</span>
							<div className="space-y-1">
								<div
									className="h-2 rounded bg-[var(--admin-warning)]"
									style={{
										width: `${Math.max(2, (point.credits / max) * 100)}%`,
									}}
									title={t("creditsTooltip", { count: point.credits })}
								/>
								<div
									className="h-2 rounded bg-[var(--admin-accent)]"
									style={{
										width: `${Math.max(2, (point.points / max) * 100)}%`,
									}}
									title={t("pointsTooltip", { count: point.points })}
								/>
							</div>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}
