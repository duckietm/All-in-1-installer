"use client";

import { ArrowRight, Loader2, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
	applyBulkOffers,
	previewBulkOffers,
	undoBulkOffers,
} from "@/actions/catalog-bulk";
import { MovePageCombobox } from "@/components/admin/catalog/catalog-items-table/field-helpers";
import { POINTS_TYPES } from "@/components/admin/catalog/catalog-items-table/types";
import {
	CurrencyIcon,
	currencyKindFromPointsType,
} from "@/components/shared/currency-icon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

type BulkInput = Parameters<typeof previewBulkOffers>[0];
type Preview = Extract<
	Awaited<ReturnType<typeof previewBulkOffers>>,
	{ ok: true }
>["data"];
type PriceMode = "set" | "add" | "percent";
type PriceField = "costCredits" | "costPoints";
type PriceDraft = { enabled: boolean; mode: PriceMode; value: string };
const emptyPrice = (): PriceDraft => ({
	enabled: false,
	mode: "set",
	value: "0",
});

export function BulkOfferEditor({
	ids,
	allPages,
	catalog = "normal",
	disabled = false,
	onApplied,
	beforeEdit,
}: {
	ids: number[];
	allPages: { id: number; caption: string }[];
	/** Which catalog the selection belongs to. BC has no undo history. */
	catalog?: "normal" | "bc";
	disabled?: boolean;
	onApplied: () => void | Promise<void>;
	beforeEdit?: () => boolean;
}) {
	const t = useTranslations("pages.admin.catalog.bulk");
	const [open, setOpen] = useState(false);
	const [prices, setPrices] = useState<Record<PriceField, PriceDraft>>({
		costCredits: emptyPrice(),
		costPoints: emptyPrice(),
	});
	const [currencyEnabled, setCurrencyEnabled] = useState(false);
	const [pointsType, setPointsType] = useState(0);
	const [destinationEnabled, setDestinationEnabled] = useState(false);
	const [pageId, setPageId] = useState<number | null>(null);
	const [preview, setPreview] = useState<{
		input: BulkInput;
		data: Preview;
		requestKey: string;
	} | null>(null);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const tooMany = ids.length > 500;
	const selectedFields =
		prices.costCredits.enabled ||
		prices.costPoints.enabled ||
		currencyEnabled ||
		destinationEnabled;

	function start() {
		if (disabled || tooMany || (beforeEdit && !beforeEdit())) return;
		setPrices({ costCredits: emptyPrice(), costPoints: emptyPrice() });
		setCurrencyEnabled(false);
		setDestinationEnabled(false);
		setPageId(null);
		setPreview(null);
		setError(null);
		setOpen(true);
	}
	function updatePrice(field: PriceField, patch: Partial<PriceDraft>) {
		setPrices((previous) => ({
			...previous,
			[field]: { ...previous[field], ...patch },
		}));
	}
	async function requestPreview() {
		if (busyRef.current || disabled || tooMany || (beforeEdit && !beforeEdit()))
			return;
		const changes: BulkInput["changes"] = {};
		for (const field of ["costCredits", "costPoints"] as const) {
			const price = prices[field];
			if (!price.enabled) continue;
			const value = Number(price.value);
			if (
				!price.value.trim() ||
				!Number.isFinite(value) ||
				(price.mode !== "percent" && !Number.isInteger(value))
			) {
				setError(t("invalidPrice"));
				return;
			}
			changes[field] = { mode: price.mode, value };
		}
		if (currencyEnabled) changes.pointsType = pointsType;
		if (destinationEnabled) {
			if (pageId === null) {
				setError(t("chooseDestination"));
				return;
			}
			changes.pageId = pageId;
		}
		if (!selectedFields) {
			setError(t("chooseFields"));
			return;
		}
		const input: BulkInput = { ids: [...ids], changes };
		busyRef.current = true;
		setBusy(true);
		setError(null);
		try {
			const result = await previewBulkOffers(input, catalog);
			if (!result.ok) {
				setError(result.error);
				return;
			}
			setPreview({ input, data: result.data, requestKey: crypto.randomUUID() });
		} catch {
			setError(t("requestFailed"));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}
	async function apply() {
		if (
			!preview ||
			busyRef.current ||
			disabled ||
			(beforeEdit && !beforeEdit())
		)
			return;
		busyRef.current = true;
		setBusy(true);
		setError(null);
		try {
			const result = await applyBulkOffers(
				preview.input,
				preview.data.fingerprint,
				preview.requestKey,
				catalog,
			);
			if (!result.ok) {
				setError(result.error);
				setPreview(null);
				return;
			}
			const undoKey = crypto.randomUUID();
			toast.success(t("success", { count: result.data.changedCount }), {
				duration: 15000,
				description: t("undoHint"),
				action: result.data.historyIds.length
					? {
							label: t("undo"),
							onClick: async () => {
								if (busyRef.current || (beforeEdit && !beforeEdit())) return;
								busyRef.current = true;
								try {
									const restored = await undoBulkOffers(
										result.data.historyIds,
										undoKey,
									);
									if (!restored.ok) {
										toast.error(restored.error);
										return;
									}
									toast.success(
										t("undoSuccess", { count: restored.data.changedCount }),
									);
									await onApplied();
								} catch {
									toast.error(t("requestFailed"));
								} finally {
									busyRef.current = false;
								}
							},
						}
					: undefined,
			});
			setOpen(false);
			await onApplied();
		} catch {
			setError(t("requestFailed"));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}
	const pageNames = new Map(
		(preview?.data.pages ?? allPages).map((page) => [page.id, page.caption]),
	);
	const currencyName = (type: number) =>
		POINTS_TYPES[type]
			? t(`currencies.${type}`)
			: t("unknownCurrency", { type });
	const renderChange = (before: React.ReactNode, after: React.ReactNode) => (
		<span className="inline-flex items-center gap-2">
			<span className="text-muted-foreground">{before}</span>
			<ArrowRight className="size-3 shrink-0" aria-label={t("becomes")} />
			<strong>{after}</strong>
		</span>
	);
	return (
		<>
			<div className="flex flex-col gap-1">
				<Button
					variant="outline"
					size="sm"
					disabled={disabled || tooMany || !ids.length}
					onClick={start}
				>
					<SlidersHorizontal className="mr-2 size-4" />
					{t("button", { count: ids.length })}
				</Button>
				{(disabled || tooMany) && (
					<span className="max-w-64 text-xs text-muted-foreground">
						{t(tooMany ? "selectionLimit" : "disabledReason")}
					</span>
				)}
			</div>
			<Dialog
				open={open}
				onOpenChange={(value) => {
					if (!busyRef.current) setOpen(value);
				}}
			>
				<DialogContent
					style={{
						backgroundColor: "var(--admin-surface)",
						color: "var(--admin-text)",
					}}
					className="min-w-0 max-h-[90vh] overflow-y-auto sm:max-w-4xl [&>*]:min-w-0"
					showCloseButton={false}
				>
					<DialogHeader>
						<DialogTitle>{t(preview ? "previewTitle" : "title")}</DialogTitle>
						<DialogDescription>
							{t("description", { count: ids.length })}
						</DialogDescription>
					</DialogHeader>
					{error && (
						<p
							role="alert"
							className="rounded-md border border-destructive p-3 text-sm text-destructive"
						>
							{error}
						</p>
					)}
					{!preview ? (
						<div className="space-y-4">
							<p className="text-sm text-muted-foreground">{t("fieldHint")}</p>
							{/* A BC offer has no price, points or currency column to
							    write. The server refuses those changes too; hiding the
							    fields keeps the dialog from offering what cannot be done. */}
							{catalog !== "bc" && (
								<>
									{(["costCredits", "costPoints"] as const).map((field) => (
										<div
											key={field}
											className="space-y-3 rounded-md border p-3"
										>
											<Label className="flex items-center gap-2">
												<Checkbox
													checked={prices[field].enabled}
													onCheckedChange={(value) =>
														updatePrice(field, { enabled: value === true })
													}
													disabled={busy}
												/>
												{t(field)}
											</Label>
											{prices[field].enabled && (
												<div className="grid gap-3 sm:grid-cols-2">
													<div className="space-y-1">
														<Label htmlFor={`bulk-${field}-mode`}>
															{t("operation")}
														</Label>
														<Select
															value={prices[field].mode}
															onValueChange={(value) =>
																updatePrice(field, { mode: value as PriceMode })
															}
															disabled={busy}
														>
															<SelectTrigger id={`bulk-${field}-mode`}>
																<SelectValue />
															</SelectTrigger>
															<SelectContent>
																{(["set", "add", "percent"] as const).map(
																	(mode) => (
																		<SelectItem key={mode} value={mode}>
																			{t(`modes.${mode}`)}
																		</SelectItem>
																	),
																)}
															</SelectContent>
														</Select>
													</div>
													<div className="space-y-1">
														<Label htmlFor={`bulk-${field}-value`}>
															{t(
																prices[field].mode === "percent"
																	? "percentage"
																	: "value",
															)}
														</Label>
														<Input
															id={`bulk-${field}-value`}
															type="number"
															step={
																prices[field].mode === "percent" ? "any" : 1
															}
															value={prices[field].value}
															onChange={(event) =>
																updatePrice(field, {
																	value: event.target.value,
																})
															}
															disabled={busy}
														/>
													</div>
												</div>
											)}
										</div>
									))}
									<div className="space-y-3 rounded-md border p-3">
										<Label className="flex items-center gap-2">
											<Checkbox
												checked={currencyEnabled}
												onCheckedChange={(value) =>
													setCurrencyEnabled(value === true)
												}
												disabled={busy}
											/>
											{t("currency")}
										</Label>
										{currencyEnabled && (
											<Select
												value={String(pointsType)}
												onValueChange={(value) => setPointsType(Number(value))}
												disabled={busy}
											>
												<SelectTrigger aria-label={t("currency")}>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{Object.keys(POINTS_TYPES).map((type) => (
														<SelectItem key={type} value={type}>
															<span className="flex items-center gap-2">
																<CurrencyIcon
																	kind={currencyKindFromPointsType(
																		Number(type),
																	)}
																	alt=""
																/>
																{currencyName(Number(type))}
															</span>
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										)}
									</div>
								</>
							)}
							<div className="space-y-3 rounded-md border p-3">
								<Label className="flex items-center gap-2">
									<Checkbox
										checked={destinationEnabled}
										onCheckedChange={(value) =>
											setDestinationEnabled(value === true)
										}
										disabled={busy}
									/>
									{t("destination")}
								</Label>
								{destinationEnabled && (
									<MovePageCombobox
										value={pageId}
										onChange={setPageId}
										pages={allPages}
										currentPageId={-1}
										disabled={busy}
										labels={{
											placeholder: t("pagePlaceholder"),
											search: t("pageSearch"),
											empty: t("pageEmpty"),
											suggested: t("pageSuggested"),
											all: t("pageAll"),
										}}
									/>
								)}
							</div>
							<p className="text-xs text-muted-foreground">{t("priceHint")}</p>
							<p className="text-xs text-muted-foreground">
								{t("visibilityHint")}
							</p>
						</div>
					) : (
						<div className="space-y-3">
							<p className="text-sm font-medium">
								{t("previewCount", {
									count: preview.data.changedCount,
									total: preview.data.rows.length,
								})}
							</p>
							<p className="text-xs text-muted-foreground">
								{t("beforeAfter")}
							</p>
							<div className="min-w-0 max-w-full max-h-[45vh] overflow-auto rounded-md border">
								<Table>
									<TableHeader>
										<TableRow>
											{(catalog === "bc"
												? ["offer", "destination"]
												: [
														"offer",
														"costCredits",
														"costPoints",
														"currency",
														"destination",
													]
											).map((key) => (
												<TableHead key={key}>{t(key)}</TableHead>
											))}
										</TableRow>
									</TableHeader>
									<TableBody>
										{preview.data.rows.map((row) => (
											<TableRow key={row.id}>
												<TableCell>
													<div className="max-w-56 whitespace-normal break-words">
														{row.catalogName}
													</div>
													<span className="text-xs text-muted-foreground">
														#{row.id}
													</span>
												</TableCell>
												{catalog !== "bc" && (
													<>
														<TableCell>
															{renderChange(
																row.before.costCredits,
																row.after.costCredits,
															)}
														</TableCell>
														<TableCell>
															{renderChange(
																row.before.costPoints,
																row.after.costPoints,
															)}
														</TableCell>
														<TableCell>
															{renderChange(
																currencyName(row.before.pointsType),
																currencyName(row.after.pointsType),
															)}
														</TableCell>
													</>
												)}
												<TableCell>
													{renderChange(
														`${pageNames.get(row.before.pageId) ?? ""} #${row.before.pageId}`,
														`${pageNames.get(row.after.pageId) ?? ""} #${row.after.pageId}`,
													)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
							{preview.data.changedCount === 0 && (
								<p className="text-sm text-muted-foreground">
									{t("noChanges")}
								</p>
							)}
						</div>
					)}
					<div className="flex min-w-0 flex-wrap justify-end gap-2 [&>button]:h-auto [&>button]:min-h-9 [&>button]:whitespace-normal">
						<Button
							variant="outline"
							onClick={() => setOpen(false)}
							disabled={busy}
						>
							{t("cancel")}
						</Button>
						{preview && (
							<Button
								variant="outline"
								onClick={() => {
									setPreview(null);
									setError(null);
								}}
								disabled={busy}
							>
								{t("back")}
							</Button>
						)}
						<Button
							onClick={preview ? apply : requestPreview}
							disabled={
								busy ||
								disabled ||
								(!preview && !selectedFields) ||
								preview?.data.changedCount === 0
							}
						>
							{busy && <Loader2 className="mr-2 size-4 animate-spin" />}
							{preview
								? t("confirm", { count: preview.data.changedCount })
								: t("preview")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
