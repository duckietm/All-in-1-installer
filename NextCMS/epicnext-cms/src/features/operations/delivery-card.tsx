import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import Link from "@/components/link";
import { deliveryTopic } from "./delivery-context";
import { deliveryDiagnosticLink } from "./delivery-diagnostics";

export interface DeliveryCardItem {
	id: string;
	operationId: string;
	topic: string;
	status: string;
	attempts: number;
	actorId: number;
	createdAt: string;
	availableAt: string;
	hasError: boolean;
	errorId?: string | null;
	context: {
		title: string | null;
		href: string | null;
		changedCount: number | null;
	};
}
export function DeliveryCard({
	item,
	retry,
}: {
	item: DeliveryCardItem;
	retry?: ReactNode;
}) {
	const t = useTranslations("pages.admin.deliveries");
	const format = useFormatter();
	const topic = deliveryTopic(item.topic);
	const state = ["pending", "running", "done", "failed"].includes(item.status)
		? item.status
		: "unknown";
	const date = (value: string) => {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime())
			? t("unknownTime")
			: format.dateTime(parsed, { dateStyle: "medium", timeStyle: "short" });
	};
	return (
		<article className="admin-card min-w-0 space-y-3">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 space-y-1">
					<p className="text-sm text-[var(--admin-text-muted)]">{t(topic)}</p>
					<h2 className="break-words text-lg font-semibold">
						{item.context.title ??
							(item.context.changedCount !== null
								? t("changedOffers", { count: item.context.changedCount })
								: t("contextUnavailable"))}
					</h2>
				</div>
				<span className="rounded-full border border-[var(--admin-border)] px-3 py-1 text-sm">
					{t(`states.${state}`)}
				</span>
			</div>
			<p className="text-sm text-[var(--admin-text-muted)]">
				{date(item.createdAt)} ·{" "}
				{item.actorId === 0 ? t("system") : t("actor", { id: item.actorId })} ·{" "}
				{t("attempts", { count: item.attempts })}
			</p>
			{state === "done" ? (
				<p className="text-sm">{t(`completed.${topic}`)}</p>
			) : (
				<p className="text-sm">{t("savedAlready")}</p>
			)}
			{item.hasError && state !== "done" && (
				<div
					className="rounded-lg border border-[var(--admin-border)] p-3 text-sm"
					role="status"
				>
					<p>{t(`issues.${topic}`)}</p>
					{state === "pending" && (
						<p className="mt-1">
							{t("nextAttempt", { time: date(item.availableAt) })}
						</p>
					)}
					{state === "failed" && (
						<p className="mt-1">{t("attemptsExhausted")}</p>
					)}
				</div>
			)}
			<div className="flex flex-wrap items-center gap-3">
				{item.context.href && (
					<Link href={item.context.href} className="btn btn-outline">
						{t("openContent")}
					</Link>
				)}
				{item.hasError && state !== "done" && (
					<Link
						href={deliveryDiagnosticLink(item.errorId)}
						className="btn btn-outline"
					>
						{t("diagnostics")}
					</Link>
				)}
				{retry}
			</div>
			<details className="text-xs text-[var(--admin-text-muted)]">
				<summary className="cursor-pointer">{t("technicalDetails")}</summary>
				<p className="mt-2 break-all">
					{t("operationReference", { id: item.operationId })}
				</p>
				<p className="break-all">{t("deliveryReference", { id: item.id })}</p>
			</details>
		</article>
	);
}
