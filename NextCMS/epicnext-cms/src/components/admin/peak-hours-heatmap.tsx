"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

interface PeakHoursData {
	/** [dayOfWeek (0=Mon..6=Sun)][hour (0..23)] = count */
	grid: number[][];
	max: number;
}

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function getColor(value: number, max: number) {
	if (max === 0 || value === 0) return "bg-muted";
	const ratio = value / max;
	if (ratio < 0.25) return "bg-[var(--admin-success)]/20";
	if (ratio < 0.5) return "bg-[var(--admin-success)]/55";
	if (ratio < 0.75)
		return "bg-[var(--admin-success)] dark:bg-[var(--admin-success)]";
	return "bg-[var(--admin-success-strong,var(--admin-success))]";
}

export function PeakHoursHeatmap({ data }: { data: PeakHoursData }) {
	const t = useTranslations("pages.admin.analytics.peakHours");
	const days = DAY_KEYS.map((key) => t(`days.${key}`));

	return (
		<Card>
			<CardHeader className="pb-2">
				<CardTitle className="text-sm font-medium">{t("title")}</CardTitle>
				<p className="text-xs text-muted-foreground">{t("description")}</p>
			</CardHeader>
			<CardContent>
				<div className="overflow-x-auto">
					<div className="min-w-[500px]">
						{/* Hour labels */}
						<div className="flex gap-px ml-10 mb-1">
							{HOURS.map((h) => (
								<div
									key={h}
									className="flex-1 text-center text-[10px] text-muted-foreground"
								>
									{h % 3 === 0 ? `${h}` : ""}
								</div>
							))}
						</div>
						{/* Rows */}
						{days.map((day, dayIdx) => (
							<div
								key={DAY_KEYS[dayIdx]}
								className="flex items-center gap-px mb-px"
							>
								<span className="w-10 text-xs text-muted-foreground text-right pr-2 shrink-0">
									{day}
								</span>
								<TooltipProvider delayDuration={0}>
									{HOURS.map((hour) => {
										const count = data.grid[dayIdx]?.[hour] ?? 0;
										return (
											<Tooltip key={hour}>
												<TooltipTrigger asChild>
													<div
														className={`flex-1 aspect-square rounded-sm ${getColor(count, data.max)} transition-colors min-w-[14px]`}
													/>
												</TooltipTrigger>
												<TooltipContent side="top" className="text-xs">
													{t("tooltip", { day, hour, count })}
												</TooltipContent>
											</Tooltip>
										);
									})}
								</TooltipProvider>
							</div>
						))}
						{/* Legend */}
						<div className="flex items-center gap-2 mt-3 ml-10">
							<span className="text-[10px] text-muted-foreground">
								{t("less")}
							</span>
							<div className="h-3 w-3 rounded-sm bg-muted" />
							<div className="h-3 w-3 rounded-sm bg-[var(--admin-success)]/20" />
							<div className="h-3 w-3 rounded-sm bg-[var(--admin-success)]/55" />
							<div className="h-3 w-3 rounded-sm bg-[var(--admin-success)] dark:bg-[var(--admin-success)]" />
							<div className="h-3 w-3 rounded-sm bg-[var(--admin-success-strong,var(--admin-success))]" />
							<span className="text-[10px] text-muted-foreground">
								{t("more")}
							</span>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
