import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { formatDate } from "@/lib/format-date";
import type { OverviewSection } from "../_lib/load-user-overview";

function eventDate(value: string | number | Date | null | undefined) {
	if (!value) return "—";
	const numeric =
		typeof value === "number" ||
		(typeof value === "string" && /^\d+$/.test(value));
	const date = numeric ? new Date(Number(value) * 1000) : new Date(value);
	return Number.isNaN(date.getTime()) ? "—" : formatDate(date);
}

export async function UserOperationalOverview({
	sections,
}: {
	sections: OverviewSection[];
}) {
	const t = await getTranslations("pages.admin.users.overview");
	return (
		<section className="space-y-4" aria-label={t("title")}>
			<p className="text-sm text-muted-foreground">{t("hint")}</p>
			{sections.length === 0 && (
				<p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
					{t("restricted")}
				</p>
			)}
			<div className="grid gap-4 xl:grid-cols-2">
				{sections.map((section) => (
					<section
						key={section.key}
						className="min-w-0 rounded-lg border bg-card p-4"
					>
						<div className="mb-3 flex items-center justify-between gap-3">
							<h3 className="font-semibold text-sm">{t(section.key)}</h3>
							{section.href && (
								<Link
									href={section.href}
									className="text-xs text-primary hover:underline"
								>
									{t("openModule")}
								</Link>
							)}
						</div>
						{section.key === "purchases" && (
							<p className="mb-2 text-xs text-muted-foreground">
								{t("purchaseHint")}
							</p>
						)}
						{section.key === "activity" && (
							<p className="mb-2 text-xs text-muted-foreground">
								{t("activityHint")}
							</p>
						)}
						{section.state === "error" ? (
							<p role="status" className="text-sm text-destructive">
								{t("error")}
							</p>
						) : section.rows.length === 0 ? (
							<p className="text-sm text-muted-foreground">{t("empty")}</p>
						) : (
							<ul className="divide-y">
								{section.rows.map((row) => (
									<li key={String(row.id)} className="space-y-1 py-2 text-sm">
										<div className="flex items-start justify-between gap-2">
											{row.href ? (
												<Link
													href={row.href}
													className="min-w-0 break-words font-medium text-primary hover:underline"
												>
													#{String(row.id)} · {row.title || "—"}
												</Link>
											) : (
												<span className="min-w-0 break-words font-medium">
													#{String(row.id)} · {row.title || "—"}
												</span>
											)}
											{row.status && (
												<span className="max-w-28 shrink-0 break-words rounded bg-muted px-1.5 py-0.5 text-xs">
													{[
														"active",
														"expired",
														"open",
														"closed",
														"reported",
														"reporter",
													].includes(row.status)
														? t(`status.${row.status}`)
														: row.status}
												</span>
											)}
										</div>
										{section.key === "purchases" && (
											<p className="text-xs text-muted-foreground">
												{t("purchaseDetail", {
													amount: row.amount ?? "—",
													credits: row.credits ?? "—",
													points: row.points ?? "—",
													type: row.pointsType ?? "—",
												})}
											</p>
										)}
										{row.detail && (
											<p className="break-words text-muted-foreground">
												{row.detail}
											</p>
										)}
										<p className="text-xs text-muted-foreground">
											{section.key === "mute"
												? t("muteUntil", { date: eventDate(row.at) })
												: eventDate(row.at)}
										</p>
									</li>
								))}
							</ul>
						)}
					</section>
				))}
			</div>
		</section>
	);
}
