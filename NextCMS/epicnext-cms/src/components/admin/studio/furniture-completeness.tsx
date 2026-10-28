"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { furnitureCompleteness } from "@/lib/furni/studio-completeness";
import type { FurnitureInspection } from "@/lib/furni/studio-inspection";
export function FurnitureCompleteness({
	local,
}: {
	local: FurnitureInspection;
}) {
	const t = useTranslations("admin.studio.completeness");
	const parts = furnitureCompleteness(local);
	return (
		<section aria-label={t("title")} className="space-y-3">
			<h3 className="font-semibold">{t("title")}</h3>
			<dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{parts.map((part) => (
					<div
						key={part.id}
						className="rounded-md border border-[var(--admin-border)] p-3"
					>
						<dt className="text-xs text-[var(--admin-text-muted)]">
							{t(`parts.${part.id}`)}
						</dt>
						<dd className="mt-1 space-y-1">
							<p
								className={
									part.status === "present"
										? "font-medium text-[var(--admin-success)]"
										: part.status === "unknown"
											? "font-medium text-[var(--admin-text-muted)]"
											: "font-medium text-[var(--admin-warning)]"
								}
							>
								{t(`statuses.${part.status}`)}
							</p>
							{part.action && (
								<p className="text-xs text-[var(--admin-text-muted)]">
									{t(`actions.${part.action}`)}
								</p>
							)}
						</dd>
					</div>
				))}
			</dl>
			{parts.some((part) => part.status === "conflict") && (
				<p role="alert" className="text-[var(--admin-warning)]">
					<Link
						href="/admin/studio/audit"
						className="font-medium underline underline-offset-4"
					>
						{t("openAudit")}
					</Link>
				</p>
			)}
		</section>
	);
}
