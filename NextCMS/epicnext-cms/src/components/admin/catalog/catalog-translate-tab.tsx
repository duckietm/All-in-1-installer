"use client";

import {
	AlertTriangle,
	CheckCircle2,
	Database,
	FileJson,
	Filter,
	Loader2,
	RotateCcw,
	Save,
	ShoppingCart,
	Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { translateCatalogItems } from "@/actions/catalog-items";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useServerAction } from "@/hooks/use-server-action";
import {
	habboGamedataHotelLabel,
	habboGamedataHotelShort,
	normalizeHabboGamedataHotel,
} from "@/lib/habbo-gamedata-hotel";
import { FurniIcon } from "./catalog-items-table";

interface BaseItemForTranslation {
	id: number;
	publicName: string;
	itemName: string;
	spriteId: number;
	type: string;
}

interface CatalogTranslateTabProps {
	baseItems: BaseItemForTranslation[];
	catalogNameMap: Record<number, string>;
	canEdit: boolean;
	furniDataIdList: number[];
	furniDescriptionMap: Record<number, string>;
	furniRevisionMap?: Record<number, { classname: string; revision: number }>;
	/** CMS setting `habbo_gamedata_hotel` — which official Habbo locale to suggest from */
	gamedataHotel?: string;
}

type FilterMode = "all" | "missing" | "modified";

export function CatalogTranslateTab({
	baseItems,
	catalogNameMap,
	canEdit,
	furniDataIdList,
	furniDescriptionMap,
	furniRevisionMap = {},
	gamedataHotel = "it",
}: CatalogTranslateTabProps) {
	const router = useRouter();
	const { run, isPending } = useServerAction();
	const [isSuggesting, setIsSuggesting] = useState(false);
	const [filterMode, setFilterMode] = useState<FilterMode>("all");
	const [activeHotel, setActiveHotel] = useState(() =>
		normalizeHabboGamedataHotel(gamedataHotel),
	);
	useEffect(() => {
		setActiveHotel(normalizeHabboGamedataHotel(gamedataHotel));
	}, [gamedataHotel]);

	// Always refresh from CMS settings so the button label tracks hotel changes
	// without requiring a full page remount after saving Settings.
	useEffect(() => {
		let cancelled = false;
		async function refreshHotel() {
			try {
				const res = await fetch("/cms_api/admin/catalog/suggest", {
					cache: "no-store",
				});
				if (!res.ok) return;
				const data = (await res.json()) as { hotel?: string };
				if (!cancelled && typeof data.hotel === "string") {
					setActiveHotel(normalizeHabboGamedataHotel(data.hotel));
				}
			} catch {
				// keep prop/default
			}
		}
		void refreshHotel();
		const onFocus = () => void refreshHotel();
		const onVisibility = () => {
			if (document.visibilityState === "visible") void refreshHotel();
		};
		window.addEventListener("focus", onFocus);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			cancelled = true;
			window.removeEventListener("focus", onFocus);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, []);

	const hotelShort = habboGamedataHotelShort(activeHotel);
	const hotelLabel = habboGamedataHotelLabel(activeHotel);

	const furniDataIdSet = useMemo(
		() => new Set(furniDataIdList),
		[furniDataIdList],
	);
	const [selected, setSelected] = useState<Set<number>>(new Set());

	// ── Editable state: names + descriptions ─────────────────────────
	const [editedNames, setEditedNames] = useState<Record<number, string>>(
		Object.fromEntries(baseItems.map((item) => [item.id, item.publicName])),
	);

	const [editedDescs, setEditedDescs] = useState<Record<number, string>>(
		Object.fromEntries(
			baseItems.map((item) => [item.id, furniDescriptionMap[item.id] ?? ""]),
		),
	);

	// Track which items have name or description changes
	const isNameChanged = useCallback(
		(item: BaseItemForTranslation) => editedNames[item.id] !== item.publicName,
		[editedNames],
	);

	const isDescChanged = useCallback(
		(item: BaseItemForTranslation) =>
			editedDescs[item.id] !== (furniDescriptionMap[item.id] ?? ""),
		[editedDescs, furniDescriptionMap],
	);

	const changedItems = useMemo(
		() =>
			baseItems.filter((item) => isNameChanged(item) || isDescChanged(item)),
		[baseItems, isNameChanged, isDescChanged],
	);

	const missingItems = useMemo(
		() => baseItems.filter((item) => !furniDataIdSet.has(item.id)),
		[baseItems, furniDataIdSet],
	);

	const filteredItems = useMemo(() => {
		switch (filterMode) {
			case "missing":
				return baseItems.filter((item) => !furniDataIdSet.has(item.id));
			case "modified":
				return baseItems.filter(
					(item) => isNameChanged(item) || isDescChanged(item),
				);
			default:
				return baseItems;
		}
	}, [baseItems, filterMode, furniDataIdSet, isNameChanged, isDescChanged]);

	const toggleOne = useCallback((id: number) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const toggleAll = useCallback(() => {
		setSelected((prev) =>
			prev.size === filteredItems.length
				? new Set()
				: new Set(filteredItems.map((i) => i.id)),
		);
	}, [filteredItems]);

	// Items to act on: selected ones if any, otherwise all
	const targetItems = useMemo(() => {
		if (selected.size === 0) return baseItems;
		return baseItems.filter((i) => selected.has(i.id));
	}, [baseItems, selected]);

	function handleNameChange(id: number, value: string) {
		setEditedNames((prev) => ({ ...prev, [id]: value }));
	}

	function handleDescChange(id: number, value: string) {
		setEditedDescs((prev) => ({ ...prev, [id]: value }));
	}

	function handleReset() {
		setEditedNames(
			Object.fromEntries(baseItems.map((item) => [item.id, item.publicName])),
		);
		setEditedDescs(
			Object.fromEntries(
				baseItems.map((item) => [item.id, furniDescriptionMap[item.id] ?? ""]),
			),
		);
	}

	async function handleSuggestFromHabboFurni() {
		if (targetItems.length === 0) return;
		setIsSuggesting(true);

		try {
			// Collect classnames from selected items (or all if none selected)
			const classnames = targetItems
				.map((item) => item.itemName)
				.filter(Boolean);
			if (classnames.length === 0) {
				toast.info("No classnames found to look up.");
				setIsSuggesting(false);
				return;
			}

			// Batch in chunks of 50 to avoid too-long URLs
			const CHUNK_SIZE = 50;
			const allSuggestions: Record<
				string,
				{ name: string; description: string }
			> = {};
			let suggestHotel = activeHotel;

			for (let i = 0; i < classnames.length; i += CHUNK_SIZE) {
				const chunk = classnames.slice(i, i + CHUNK_SIZE);
				const res = await fetch(
					`/cms_api/admin/catalog/suggest?classnames=${encodeURIComponent(chunk.join(","))}`,
				);
				if (res.ok) {
					const data = await res.json();
					if (typeof data.hotel === "string") {
						suggestHotel = normalizeHabboGamedataHotel(data.hotel);
						setActiveHotel(suggestHotel);
					}
					Object.assign(allSuggestions, data.suggestions || {});
				}
			}
			const suggestLabel = habboGamedataHotelLabel(suggestHotel);

			// Apply suggestions to items that have a match (names + descriptions)
			let nameCount = 0;
			let descCount = 0;
			const newNames = { ...editedNames };
			const newDescs = { ...editedDescs };

			for (const item of targetItems) {
				const suggestion = allSuggestions[item.itemName];
				if (!suggestion) continue;

				if (suggestion.name && suggestion.name !== item.publicName) {
					newNames[item.id] = suggestion.name;
					nameCount++;
				}

				const currentDesc = furniDescriptionMap[item.id] ?? "";
				if (suggestion.description && suggestion.description !== currentDesc) {
					newDescs[item.id] = suggestion.description;
					descCount++;
				}
			}

			setEditedNames(newNames);
			setEditedDescs(newDescs);

			const total = nameCount + descCount;
			if (total > 0) {
				const parts = [];
				if (nameCount > 0) parts.push(`${nameCount} name(s)`);
				if (descCount > 0) parts.push(`${descCount} description(s)`);
				toast.success(
					`${parts.join(" + ")} suggested from ${suggestLabel}. Review and save.`,
				);
			} else {
				toast.info(
					`No new suggestions from ${suggestLabel} (${Object.keys(allSuggestions).length} looked up, all already match).`,
				);
			}
		} catch (err) {
			toast.error(`Suggest error: ${(err as Error).message}`);
		} finally {
			setIsSuggesting(false);
		}
	}

	async function handleSaveAll() {
		if (changedItems.length === 0) return;

		run(
			() =>
				translateCatalogItems({
					items: changedItems.map((item) => ({
						id: item.id,
						publicName: editedNames[item.id],
						description: editedDescs[item.id],
					})),
				}),
			{
				successMessage: "Translations saved.",
				errorMessage: "Failed to save translations.",
				onSuccess: (data) => {
					const d = data as Record<string, number | boolean>;
					const parts = [];
					if (d.namesUpdated && (d.namesUpdated as number) > 0)
						parts.push(`${d.namesUpdated} name(s) updated`);
					if (d.descriptionsUpdated && (d.descriptionsUpdated as number) > 0)
						parts.push(`${d.descriptionsUpdated} description(s) updated`);
					if (parts.length === 0)
						parts.push(`${d.updated ?? 0} item(s) processed`);
					if (d.furniDataUpdated) parts.push("FurnitureData.json synced");
					if (d.furniDataInserted && (d.furniDataInserted as number) > 0) {
						parts.push(
							`${d.furniDataInserted} new item(s) added to FurnitureData.json`,
						);
					}
					parts.push("emulator cache refreshed");
					toast.success(`${parts.join(" · ")}.`);
					router.refresh();
				},
			},
		);
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-4">
				<div className="min-w-0">
					<CardTitle>Translate Item Names</CardTitle>
					<p className="text-sm text-muted-foreground mt-1">
						Edit the public name and description of furniture items. Saving will
						update:
					</p>
					<div className="flex gap-3 mt-2 flex-wrap">
						<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
							<Database className="h-3 w-3" /> items_base (name)
						</span>
						<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
							<ShoppingCart className="h-3 w-3" /> catalogName (auto)
						</span>
						<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
							<FileJson className="h-3 w-3" /> FurnitureData.json (name + desc)
						</span>
					</div>
					{missingItems.length > 0 && (
						<div className="flex items-center gap-1.5 mt-2 text-xs text-[var(--admin-warning)] dark:text-[var(--admin-warning)]">
							<AlertTriangle className="h-3.5 w-3.5" />
							<span>
								{missingItems.length} item(s) missing from FurnitureData.json —
								will be auto-inserted on save
							</span>
						</div>
					)}
				</div>
				{canEdit && (
					<div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
						<Button
							variant="outline"
							size="sm"
							onClick={handleSuggestFromHabboFurni}
							disabled={isSuggesting || isPending || targetItems.length === 0}
							title={`Suggest names + descriptions from ${hotelLabel}. Change hotel in Admin → Settings → Game assets.`}
						>
							{isSuggesting ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Sparkles className="mr-2 h-4 w-4" />
							)}
							Suggest {hotelShort}
							{selected.size > 0 ? ` (${selected.size})` : ""}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={handleReset}
							disabled={changedItems.length === 0 || isPending}
						>
							<RotateCcw className="mr-2 h-4 w-4" />
							Reset
						</Button>
						<Button
							size="sm"
							onClick={handleSaveAll}
							disabled={isPending || changedItems.length === 0}
						>
							{isPending ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Save className="mr-2 h-4 w-4" />
							)}
							Save All ({changedItems.length})
						</Button>
					</div>
				)}
			</CardHeader>
			<CardContent>
				{/* Filter bar */}
				{baseItems.length > 0 && (
					<div className="flex items-center gap-2 mb-4">
						<Filter className="h-4 w-4 text-muted-foreground" />
						<div className="flex gap-1">
							<Button
								variant={filterMode === "all" ? "default" : "outline"}
								size="sm"
								className="h-7 text-xs"
								onClick={() => setFilterMode("all")}
							>
								All ({baseItems.length})
							</Button>
							<Button
								variant={filterMode === "missing" ? "default" : "outline"}
								size="sm"
								className="h-7 text-xs"
								onClick={() => setFilterMode("missing")}
								disabled={missingItems.length === 0}
							>
								<AlertTriangle className="mr-1 h-3 w-3" />
								Missing ({missingItems.length})
							</Button>
							<Button
								variant={filterMode === "modified" ? "default" : "outline"}
								size="sm"
								className="h-7 text-xs"
								onClick={() => setFilterMode("modified")}
								disabled={changedItems.length === 0}
							>
								Modified ({changedItems.length})
							</Button>
						</div>
					</div>
				)}

				{baseItems.length === 0 ? (
					<p className="text-sm text-muted-foreground text-center py-8">
						No items to translate in this page.
					</p>
				) : filteredItems.length === 0 ? (
					<p className="text-sm text-muted-foreground text-center py-8">
						No items match the current filter.
					</p>
				) : (
					<TooltipProvider>
						<div className="rounded-md border overflow-auto max-h-[600px]">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-[40px] px-2">
											<Checkbox
												checked={
													filteredItems.length > 0 &&
													selected.size === filteredItems.length
												}
												onCheckedChange={toggleAll}
												aria-label="Select all"
											/>
										</TableHead>
										<TableHead className="w-[50px]"></TableHead>
										<TableHead className="w-[60px]">ID</TableHead>
										<TableHead className="w-[80px]">Type</TableHead>
										<TableHead>Item Name</TableHead>
										<TableHead className="min-w-[200px]">Public Name</TableHead>
										<TableHead className="min-w-[200px]">Description</TableHead>
										<TableHead className="w-[100px]">Status</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredItems.map((item) => {
										const nameChanged = isNameChanged(item);
										const descChanged = isDescChanged(item);
										const isChanged = nameChanged || descChanged;
										const isMissing = !furniDataIdSet.has(item.id);
										const currentCatalogName = catalogNameMap[item.id];
										return (
											<TableRow
												key={item.id}
												className={
													isChanged
														? "bg-[var(--admin-warning-subtle)] dark:bg-[var(--admin-warning-subtle)]"
														: isMissing
															? "bg-[var(--admin-warning-subtle)] dark:bg-[var(--admin-warning-subtle)]"
															: undefined
												}
											>
												<TableCell className="px-2">
													<Checkbox
														checked={selected.has(item.id)}
														onCheckedChange={() => toggleOne(item.id)}
														aria-label={`Select ${item.itemName}`}
													/>
												</TableCell>
												<TableCell className="px-1">
													{(() => {
														const revInfo = furniRevisionMap[item.id];
														return revInfo ? (
															<FurniIcon
																classname={revInfo.classname}
																revision={revInfo.revision}
															/>
														) : (
															<FurniIcon
																classname={item.itemName}
																revision={0}
															/>
														);
													})()}
												</TableCell>
												<TableCell className="font-mono text-xs">
													{item.id}
												</TableCell>
												<TableCell>
													<Badge
														variant={
															item.type === "s" ? "default" : "secondary"
														}
														className="text-xs"
													>
														{item.type === "s"
															? "Floor"
															: item.type === "i"
																? "Wall"
																: item.type}
													</Badge>
												</TableCell>
												<TableCell className="text-xs text-muted-foreground font-mono">
													{item.itemName}
												</TableCell>
												<TableCell>
													<Input
														value={editedNames[item.id] || ""}
														onChange={(e) =>
															handleNameChange(item.id, e.target.value)
														}
														disabled={!canEdit}
														className={`h-8 text-sm ${nameChanged ? "border-[var(--admin-warning-border)] dark:border-[var(--admin-warning-border)]" : ""}`}
													/>
													{currentCatalogName &&
														currentCatalogName !== item.publicName && (
															<p className="text-[11px] text-muted-foreground mt-0.5 truncate">
																catalog: {currentCatalogName}
															</p>
														)}
												</TableCell>
												<TableCell>
													<Input
														value={editedDescs[item.id] || ""}
														onChange={(e) =>
															handleDescChange(item.id, e.target.value)
														}
														disabled={!canEdit}
														placeholder="No description"
														className={`h-8 text-sm ${descChanged ? "border-[var(--admin-warning-border)] dark:border-[var(--admin-warning-border)]" : ""}`}
													/>
												</TableCell>
												<TableCell>
													<div className="flex items-center gap-1.5">
														{isChanged ? (
															<Badge
																variant="secondary"
																className="text-xs bg-[var(--admin-warning-subtle)] text-[var(--admin-warning)]"
															>
																Modified
															</Badge>
														) : (
															<span className="text-xs text-muted-foreground">
																—
															</span>
														)}
														{isMissing ? (
															<Tooltip>
																<TooltipTrigger asChild>
																	<AlertTriangle className="h-3.5 w-3.5 text-[var(--admin-warning)] flex-shrink-0" />
																</TooltipTrigger>
																<TooltipContent>
																	<p>Missing from FurnitureData.json</p>
																	<p className="text-xs text-muted-foreground">
																		Will be auto-inserted on save
																	</p>
																</TooltipContent>
															</Tooltip>
														) : (
															<Tooltip>
																<TooltipTrigger asChild>
																	<CheckCircle2 className="h-3.5 w-3.5 text-[var(--admin-success)] flex-shrink-0" />
																</TooltipTrigger>
																<TooltipContent>
																	In FurnitureData.json
																</TooltipContent>
															</Tooltip>
														)}
													</div>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>
					</TooltipProvider>
				)}
			</CardContent>
		</Card>
	);
}
