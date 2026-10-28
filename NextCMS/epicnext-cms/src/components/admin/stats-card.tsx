import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import Link from "@/components/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatsCardProps {
	title: string;
	value: string | number;
	description?: string;
	icon?: React.ReactNode;
	href?: string;
	/** Percentage change vs previous period. Positive = up, negative = down, undefined = no trend */
	trend?: number;
}

export function StatsCard({
	title,
	value,
	description,
	icon,
	href,
	trend,
}: StatsCardProps) {
	const content = (
		<Card
			className={
				href
					? "transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5 cursor-pointer"
					: ""
			}
		>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="text-sm font-medium">{title}</CardTitle>
				{icon && <div className="text-muted-foreground">{icon}</div>}
			</CardHeader>
			<CardContent>
				<div className="flex items-baseline gap-2">
					<div className="text-2xl font-bold">{value}</div>
					{trend !== undefined && <TrendBadge value={trend} />}
				</div>
				{description && (
					<p className="text-xs text-muted-foreground">{description}</p>
				)}
			</CardContent>
		</Card>
	);

	if (href) {
		return <Link href={href}>{content}</Link>;
	}

	return content;
}

function TrendBadge({ value }: { value: number }) {
	if (value === 0) {
		return (
			<span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
				<Minus className="h-3 w-3" />
				0%
			</span>
		);
	}

	const isUp = value > 0;
	return (
		<span
			className={`inline-flex items-center gap-0.5 text-xs font-medium ${
				isUp ? "text-[var(--admin-success)]" : "text-[var(--admin-error)]"
			}`}
		>
			{isUp ? (
				<TrendingUp className="h-3 w-3" />
			) : (
				<TrendingDown className="h-3 w-3" />
			)}
			{isUp ? "+" : ""}
			{value}%
		</span>
	);
}
