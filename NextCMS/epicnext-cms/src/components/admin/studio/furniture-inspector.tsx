"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
	compareFurniture,
	type FurnitureInspection,
	furnitureHealth,
} from "@/lib/furni/studio-inspection";
import { FurnitureCompleteness } from "./furniture-completeness";
import type { FurniItem } from "./studio-types";
import { useFurnitureInspection } from "./use-furniture-inspection";

const HEALTH_KEYS = {
	complete: "healthComplete",
	incomplete: "healthIncomplete",
	new: "healthNew",
	conflict: "healthConflict",
	unknown: "healthUnknown",
} as const;

const FIELD_KEYS = {
	Name: "fieldName",
	Description: "fieldDescription",
	Revision: "fieldRevision",
	Type: "fieldType",
} as const;

export function FurnitureComparison({
	item,
	local,
}: {
	item: FurniItem;
	local: FurnitureInspection;
}) {
	const t = useTranslations("admin.studio.inspector");
	const comparison = compareFurniture(item, local);
	return (
		<div className="space-y-3 text-sm">
			<FurnitureCompleteness local={local} />
			{!local.furnidataReadable && (
				<p className="text-[var(--admin-warning)]">
					{t("furnidataUnreadable")}
				</p>
			)}
			<div className="overflow-x-auto">
				<table className="w-full text-xs">
					<thead>
						<tr>
							<th className="p-2 text-left">{t("field")}</th>
							<th className="p-2 text-left">{t("localNow")}</th>
							<th className="p-2 text-left">{t("source")}</th>
						</tr>
					</thead>
					<tbody>
						{comparison.fields.map((field) => {
							const labelKey =
								FIELD_KEYS[field.label as keyof typeof FIELD_KEYS];
							return (
								<tr
									key={field.label}
									className={
										field.changed ? "bg-[var(--admin-warning)]/10" : ""
									}
								>
									<th className="p-2 text-left">
										{labelKey ? t(labelKey) : field.label}
										{field.changed ? ` · ${t("changed")}` : ""}
									</th>
									<td className="max-w-48 break-words p-2">
										{field.before ?? "—"}
									</td>
									<td className="max-w-48 break-words p-2">
										{field.after ?? t("notSupplied")}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			<p className="text-xs text-[var(--admin-text-muted)]">
				{t("compareNote")}
			</p>
			<details>
				<summary className="cursor-pointer font-medium">
					{t("sqlRecords")}
				</summary>
				<div className="mt-2 space-y-2 text-xs">
					{local.sql.length ? (
						local.sql.map((row) => (
							<p key={row.id}>
								{t("itemRow", {
									id: row.id,
									sprite: row.spriteId,
									name: row.name,
								})}
							</p>
						))
					) : (
						<p>{t("noSqlItem")}</p>
					)}
					{local.catalog.map((row) => (
						<p key={row.id}>
							{t("offerRow", {
								id: row.id,
								page: row.pageId,
								credits: row.credits,
								points: row.points,
							})}
						</p>
					))}
				</div>
			</details>
		</div>
	);
}
export function FurnitureInspector({
	item,
	onRepair,
	busy = false,
}: {
	item: FurniItem;
	onRepair?: () => Promise<unknown>;
	busy?: boolean;
}) {
	const t = useTranslations("admin.studio.inspector");
	const inspection = useFurnitureInspection([item.classname]);
	if (inspection.loading)
		return (
			<p role="status" className="py-3 text-sm">
				{t("checking")}
			</p>
		);
	if (inspection.error)
		return (
			<div role="alert">
				<p>{inspection.error}</p>
				<Button variant="outline" onClick={inspection.retry}>
					{t("retry")}
				</Button>
			</div>
		);
	const local = inspection.items.find(
		(entry) => entry.classname === item.classname,
	);
	const health = local ? furnitureHealth(local) : null;
	return local && health ? (
		<div className="space-y-3">
			<section className="rounded-md border border-[var(--admin-border)] p-3 space-y-2">
				<strong>{t(HEALTH_KEYS[health.state])}</strong>
				{health.missing.length > 0 && (
					<p className="text-sm">
						{t("missing", { parts: health.missing.join(", ") })}
					</p>
				)}
				{health.state === "conflict" && (
					<p className="text-sm">{t("conflictNote")}</p>
				)}
				{health.state === "unknown" && (
					<p className="text-sm">{t("unknownNote")}</p>
				)}
				{health.state === "incomplete" && onRepair && (
					<>
						<p className="text-sm text-[var(--admin-text-muted)]">
							{t("repairNote")}
						</p>
						<Button disabled={busy} onClick={() => void onRepair()}>
							{busy ? t("repairQueued") : t("repair")}
						</Button>
					</>
				)}
				<Button variant="outline" disabled={busy} onClick={inspection.retry}>
					{t("recheck")}
				</Button>
			</section>
			<FurnitureComparison item={item} local={local} />
		</div>
	) : (
		<p>{t("unavailable")}</p>
	);
}
