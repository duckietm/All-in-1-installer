"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { adminFetch } from "@/lib/admin-fetch";
import { previewAutoCatalog } from "@/lib/furni/auto-catalog";
import { compareFurniture } from "@/lib/furni/studio-inspection";
import { FurnitureComparison } from "./furniture-inspector";
import { importRecommendation } from "./import-recommendation";
import { ImportSourceDiagnostics } from "./import-source-diagnostics";
import type { FurniItem } from "./studio-types";
import { useFurnitureInspection } from "./use-furniture-inspection";
import { useSourceAssetChecks } from "./use-source-asset-checks";

export function ImportReview({
	items,
	sourceId,
	source,
	translation,
	onCancel,
	busy = false,
	onConfirm,
}: {
	items: FurniItem[];
	sourceId?: string;
	source: string;
	translation: string;
	onCancel: () => void;
	busy?: boolean;
	onConfirm: (items: FurniItem[]) => void;
}) {
	const preflightT = useTranslations("admin.studio.preflight");
	const reviewT = useTranslations("admin.studio.review");
	const [reviewFilter, setReviewFilter] = useState<
		"all" | "complete" | "conflict" | "verify"
	>("all");
	const diagnosticsT = useTranslations("admin.studio.importDiagnostics");
	const completenessT = useTranslations("admin.studio.completeness");
	const [attachments, setAttachments] = useState<Record<string, string>>({});
	const [uploading, setUploading] = useState<string | null>(null);
	async function attach(item: FurniItem, file: File) {
		setUploading(item.classname);
		try {
			const form = new FormData();
			form.set("classname", item.classname);
			form.set("file", file);
			const response = await adminFetch("/api/admin/studio/import-attachment", {
				method: "POST",
				body: form,
			});
			const data = await response.json();
			if (!response.ok) throw Error(data.error || reviewT("uploadFailed"));
			setAttachments((current) => ({
				...current,
				[item.classname]: data.attachmentId,
			}));
			toast.success(diagnosticsT("attached"));
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : reviewT("uploadFailed"),
			);
		} finally {
			setUploading(null);
		}
	}
	const progressT = useTranslations("pages.admin.importProgress");
	const inspection = useFurnitureInspection(
		items.map((item) => item.classname),
	);
	const assets = useSourceAssetChecks(items, sourceId, inspection);
	const unavailable = assets.items.filter(
		(item) => item.state === "missing" && !attachments[item.classname],
	);
	const [expanded, setExpanded] = useState(items[0]?.classname ?? "");
	const [step, setStep] = useState<"review" | "confirm">("review");
	const [page, setPage] = useState(0);
	const localByName = new Map(
		inspection.items.map((item) => [item.classname, item]),
	);
	const complete = items.every((item) => localByName.has(item.classname));
	const ready = items.filter((item) => {
		const local = localByName.get(item.classname);
		return local && compareFurniture(item, local).state !== "conflict";
	});
	const blocked = items.filter((item) => {
		const local = localByName.get(item.classname);
		return local && compareFurniture(item, local).state === "conflict";
	}).length;
	const existing = items.filter((item) => {
		const local = localByName.get(item.classname);
		return (
			local &&
			local.sql.length > 0 &&
			compareFurniture(item, local).state !== "conflict"
		);
	}).length;
	const recommendations = new Map(
		inspection.items.map((local) => [
			local.classname,
			importRecommendation(local),
		]),
	);
	const reviewItems =
		reviewFilter === "all"
			? items
			: items.filter(
					(item) =>
						recommendations.get(item.classname)?.action === reviewFilter,
				);
	const pageItems = (step === "review" ? reviewItems : ready).slice(
		page * 50,
		(page + 1) * 50,
	);
	const pageCount = Math.max(
		1,
		Math.ceil((step === "review" ? reviewItems : ready).length / 50),
	);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy && !uploading) onCancel();
			}}
		>
			<DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-3xl sm:max-w-3xl flex-col overflow-hidden border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-text)]">
				<DialogHeader>
					<DialogTitle>
						{step === "review"
							? reviewT("titleReview")
							: reviewT("titleConfirm")}
					</DialogTitle>
					<DialogDescription>{reviewT("steps")}</DialogDescription>
				</DialogHeader>
				<div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
					<div className="rounded-lg bg-[var(--admin-canvas)] p-3 text-sm">
						<p>
							<strong>{reviewT("source")}</strong> {source}
						</p>
						<p>
							<strong>{reviewT("destination")}</strong>{" "}
							{reviewT("destinationValue")}
						</p>
						<p>
							<strong>{reviewT("translation")}</strong> {translation}
						</p>
						<p>
							<strong>{reviewT("selection")}</strong>{" "}
							{reviewT("selectionCount", { count: items.length })}
						</p>
					</div>
					{assets.loading && !inspection.loading && (
						<p role="status">
							{reviewT("checkingSource", { count: assets.items.length })}
						</p>
					)}
					{assets.error && (
						<div role="alert">
							<p>{assets.error}</p>
							<Button variant="outline" onClick={assets.retry}>
								{reviewT("retrySource")}
							</Button>
						</div>
					)}
					{assets.items.some((item) => item.state === "unknown") && (
						<p className="text-sm text-[var(--admin-warning)]">
							{reviewT("unknownSources")}
						</p>
					)}
					{unavailable.map((check) => (
						<section
							key={check.classname}
							className="rounded-lg border border-[var(--admin-border)] p-3 space-y-2"
						>
							<p className="text-sm font-medium">
								{reviewT("sourceNotFound", { name: check.classname })}
							</p>
							<p className="text-xs text-[var(--admin-text-muted)]">
								{progressT("recoveryHint")}
							</p>
						</section>
					))}
					{inspection.loading ? (
						<p role="status">{reviewT("checkingLocal")}</p>
					) : inspection.error ? (
						<div role="alert">
							<p>{inspection.error}</p>
							<Button variant="outline" onClick={inspection.retry}>
								{reviewT("retryInspection")}
							</Button>
						</div>
					) : !complete ? (
						<p role="alert">{reviewT("incomplete")}</p>
					) : (
						<>
							<p role="status" className="text-sm">
								{reviewT("summary", {
									ready: ready.length,
									existing,
									blocked,
									warnings: unavailable.length,
								})}
							</p>
							{blocked > 0 && (
								<div
									role="alert"
									className="rounded-md border border-[var(--admin-warning)]/30 bg-[var(--admin-warning)]/10 p-3 text-sm"
								>
									<p>
										{completenessT("excludedConflicts", { count: blocked })}
									</p>
									<Link
										href="/admin/studio/audit"
										className="font-medium underline underline-offset-4"
									>
										{completenessT("openAudit")}
									</Link>
								</div>
							)}
							{inspection.items.some(
								(item) =>
									!item.furnidataReadable ||
									item.icon.exists === null ||
									item.nitro.exists === null,
							) && (
								<p className="text-sm text-[var(--admin-warning)]">
									{reviewT("localUnverified")}
								</p>
							)}
							{step === "review" ? (
								<div className="space-y-2">
									<fieldset
										className="flex flex-wrap gap-2"
										aria-label={preflightT("filterLabel")}
									>
										{(["all", "complete", "conflict", "verify"] as const).map(
											(filter) => (
												<Button
													key={filter}
													variant="outline"
													aria-pressed={reviewFilter === filter}
													onClick={() => {
														setReviewFilter(filter);
														setPage(0);
														setExpanded("");
													}}
												>
													{preflightT(`filters.${filter}`, {
														count:
															filter === "all"
																? items.length
																: items.filter(
																		(item) =>
																			recommendations.get(item.classname)
																				?.action === filter,
																	).length,
													})}
												</Button>
											),
										)}
									</fieldset>
									{reviewItems.length === 0 && (
										<p
											role="status"
											className="p-3 text-sm text-[var(--admin-text-muted)]"
										>
											{preflightT("empty")}
										</p>
									)}
									{pageItems.map((item) => {
										const local = localByName.get(item.classname);
										if (!local) return null;
										const comparison = compareFurniture(item, local);
										const recommendation = importRecommendation(local);
										return (
											<div
												key={item.classname}
												className="rounded-lg border border-[var(--admin-border)]"
											>
												<button
													type="button"
													aria-expanded={expanded === item.classname}
													onClick={() =>
														setExpanded(
															expanded === item.classname ? "" : item.classname,
														)
													}
													className="flex min-h-11 w-full items-center justify-between gap-3 p-3 text-left text-sm"
												>
													<span className="min-w-0 break-words">
														{item.name}
														<span className="block text-xs text-[var(--admin-text-muted)]">
															{item.classname}
														</span>
														<span className="mt-1 block text-xs font-medium">
															{preflightT(`actions.${recommendation.action}`)}
														</span>
														{recommendation.missing.length > 0 && (
															<span className="mt-1 block text-xs text-[var(--admin-warning)]">
																{preflightT("missing", {
																	parts: recommendation.missing
																		.map((part) =>
																			completenessT(`parts.${part}`),
																		)
																		.join(", "),
																})}
															</span>
														)}
														{recommendation.unknown.length > 0 && (
															<span className="mt-1 block text-xs text-[var(--admin-text-muted)]">
																{preflightT("unknown", {
																	parts: recommendation.unknown
																		.map((part) =>
																			completenessT(`parts.${part}`),
																		)
																		.join(", "),
																})}
															</span>
														)}
													</span>
													<span>
														{comparison.state === "new"
															? reviewT("statusNew")
															: comparison.state === "changed"
																? reviewT("statusChanged")
																: comparison.state === "conflict"
																	? reviewT("statusConflict")
																	: comparison.state === "unknown"
																		? reviewT("statusUnknown")
																		: reviewT("statusPresent")}
													</span>
												</button>
												{expanded === item.classname && (
													<div className="border-t border-[var(--admin-border)] p-3">
														{local.nitro.exists !== true && (
															<label className="mt-3 block text-sm">
																{attachments[item.classname]
																	? diagnosticsT("attached")
																	: diagnosticsT("attach")}
																<input
																	className="mt-2 block max-w-full"
																	type="file"
																	accept=".hab,.nitro"
																	disabled={busy || uploading !== null}
																	onChange={(event) => {
																		const file = event.target.files?.[0];
																		if (file) void attach(item, file);
																		event.target.value = "";
																	}}
																/>
																{uploading === item.classname && (
																	<span role="status">
																		{reviewT("validatingFile")}
																	</span>
																)}
															</label>
														)}
														{assets.items.find(
															(check) => check.classname === item.classname,
														) && (
															<ImportSourceDiagnostics
																check={assets.items.find(
																	(check) => check.classname === item.classname,
																)}
															/>
														)}
														<FurnitureComparison item={item} local={local} />
													</div>
												)}
											</div>
										);
									})}
								</div>
							) : (
								<>
									<p className="text-sm">
										{reviewT("confirmIntro", { count: ready.length })}
									</p>
									<p className="text-xs text-[var(--admin-text-muted)]">
										{reviewT("confirmEstimates")}
									</p>
									<ul className="space-y-2">
										{pageItems.map((item) => {
											const placement = previewAutoCatalog(
												item.classname,
												item.type,
											);
											return (
												<li
													key={item.classname}
													className="rounded-md border border-[var(--admin-border)] p-2 text-sm"
												>
													<strong>{item.name}</strong>
													<p>
														{reviewT("placement", {
															category: placement.categoryLabel,
															credits: placement.credits,
															points: placement.points,
														})}
													</p>
												</li>
											);
										})}
									</ul>
								</>
							)}
						</>
					)}
				</div>
				{!inspection.loading && !inspection.error && pageCount > 1 && (
					<div className="flex items-center justify-between gap-2 text-sm">
						<Button
							variant="outline"
							disabled={page === 0}
							onClick={() => setPage((value) => value - 1)}
						>
							{reviewT("previous")}
						</Button>
						<span>{reviewT("page", { page: page + 1, total: pageCount })}</span>
						<Button
							variant="outline"
							disabled={page + 1 === pageCount}
							onClick={() => setPage((value) => value + 1)}
						>
							{reviewT("next")}
						</Button>
					</div>
				)}
				<DialogFooter>
					<Button
						variant="outline"
						disabled={busy || uploading !== null}
						onClick={
							step === "confirm"
								? () => {
										setStep("review");
										setPage(0);
									}
								: onCancel
						}
					>
						{step === "confirm" ? reviewT("backToReview") : reviewT("cancel")}
					</Button>
					<Button
						style={{
							backgroundColor: "var(--admin-accent)",
							color: "var(--admin-accent-foreground)",
						}}
						disabled={
							busy ||
							uploading !== null ||
							inspection.loading ||
							!!inspection.error ||
							!complete ||
							ready.length === 0
						}
						onClick={() => {
							if (step === "review") {
								setStep("confirm");
								setPage(0);
							} else
								onConfirm(
									ready.map((item) => ({
										...item,
										attachmentId: attachments[item.classname],
									})),
								);
						}}
					>
						{step === "review"
							? reviewT("continue")
							: reviewT("startImport", { count: ready.length })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
