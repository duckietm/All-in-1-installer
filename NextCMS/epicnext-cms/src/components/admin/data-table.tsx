"use client";

import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
	Download,
	Filter,
	Search,
	SlidersHorizontal,
	X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { TableSavedViews } from "@/components/admin/table-saved-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
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
import { PER_PAGE_OPTIONS } from "@/lib/admin-helpers";
import { tablePageNumbers } from "@/lib/admin-table-state";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

/**
 * One-click filter preset. The chip applies/clears the listed query-string
 * keys at once; the preset is "active" when every key matches the URL state.
 */
export interface DataTablePreset {
	label: string;
	params: Record<string, string>;
}

interface DataTableProps<T extends { id: number | string }> {
	data: PaginatedResult<T>;
	columns: DataTableColumn<T>[];
	searchPlaceholder?: string;
	bulkActions?: {
		label: string;
		value: string;
		variant?: "destructive" | "default";
	}[];
	onBulkAction?: (action: string, ids: (number | string)[]) => Promise<void>;
	exportUrl?: string;
	presets?: DataTablePreset[];
}

export function DataTable<T extends { id: number | string }>({
	data,
	columns,
	searchPlaceholder,
	bulkActions,
	onBulkAction,
	exportUrl,
	presets,
}: DataTableProps<T>) {
	const t = useTranslations("pages.admin.table");
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [isPending, startTransition] = useTransition();

	const scope = `${pathname}?${searchParams.toString()}:${data.rows.map((row) => row.id).join(",")}`;
	const [selection, setSelection] = useState<{
		scope: string;
		ids: Set<number | string>;
	}>({ scope, ids: new Set() });
	const selectedIds =
		selection.scope === scope ? selection.ids : new Set<number | string>();
	function setSelectedIds(
		value:
			| Set<number | string>
			| ((prev: Set<number | string>) => Set<number | string>),
	) {
		setSelection({
			scope,
			ids: typeof value === "function" ? value(selectedIds) : value,
		});
	}
	const urlSearch = searchParams.get("search") ?? "";
	const [draft, setDraft] = useState({ base: urlSearch, value: urlSearch });
	if (draft.base !== urlSearch) setDraft({ base: urlSearch, value: urlSearch });
	const searchValue = draft.base === urlSearch ? draft.value : urlSearch;
	const [bulkBusy, setBulkBusy] = useState(false);
	const bulkLock = useRef(false);

	const [columnPreference, setColumnPreference] = useState<{
		path: string;
		hidden: Set<string>;
	}>(() => ({ path: pathname, hidden: new Set() }));
	const hiddenColumns =
		columnPreference.path === pathname &&
		!columns.every((column) => columnPreference.hidden.has(column.key))
			? columnPreference.hidden
			: new Set<string>();
	useEffect(() => {
		try {
			const raw: unknown = JSON.parse(
				sessionStorage.getItem(`cms-table-columns:${pathname}`) ?? "[]",
			);
			const hidden = Array.isArray(raw)
				? raw.filter((key): key is string => typeof key === "string")
				: [];
			setColumnPreference({ path: pathname, hidden: new Set(hidden) });
		} catch {
			setColumnPreference({ path: pathname, hidden: new Set() });
		}
	}, [pathname]);
	function setHiddenColumns(update: (previous: Set<string>) => Set<string>) {
		const next = update(hiddenColumns);
		// Leave at least one data column available, even after a stale saved preference.
		if (columns.every((column) => next.has(column.key))) return;
		setColumnPreference({ path: pathname, hidden: next });
		try {
			sessionStorage.setItem(
				`cms-table-columns:${pathname}`,
				JSON.stringify([...next]),
			);
		} catch {
			/* Storage can be disabled by the browser. */
		}
	}

	const currentSort = searchParams.get("sort") || "";
	const currentOrder = searchParams.get("order") || "desc";

	// Collect active filters from URL
	const filterColumns = columns.filter(
		(col) => col.filterOptions && col.filterOptions.length > 0,
	);
	const activeFilters: Record<string, string> = {};
	for (const col of filterColumns) {
		const key = col.filterKey || `filter_${col.key}`;
		const val = searchParams.get(key);
		if (val) activeFilters[key] = val;
	}
	const activeFilterCount = Object.keys(activeFilters).length;

	function updateParams(updates: Record<string, string>) {
		const params = new URLSearchParams(searchParams.toString());
		for (const [key, value] of Object.entries(updates)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		startTransition(() => {
			router.push(`?${params.toString()}`, { scroll: false });
		});
	}

	useEffect(() => {
		if (searchValue === urlSearch) return;
		const timer = setTimeout(() => {
			const params = new URLSearchParams(searchParams.toString());
			if (searchValue) params.set("search", searchValue);
			else params.delete("search");
			params.set("page", "1");
			startTransition(() =>
				router.replace(`?${params.toString()}`, { scroll: false }),
			);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchValue, urlSearch, searchParams, router]);
	function handleSearch(value: string) {
		setDraft({ base: urlSearch, value });
	}

	function handleSort(key: string) {
		const newOrder =
			currentSort === key && currentOrder === "asc" ? "desc" : "asc";
		updateParams({ sort: key, order: newOrder, page: "1" });
	}

	function handlePageChange(page: number) {
		updateParams({ page: String(page) });
	}

	function handlePerPageChange(perPage: string) {
		updateParams({ perPage, page: "1" });
	}

	function handleFilterChange(col: DataTableColumn<T>, value: string) {
		const key = col.filterKey || `filter_${col.key}`;
		updateParams({ [key]: value === "__all__" ? "" : value, page: "1" });
	}

	function clearAllFilters() {
		const updates: Record<string, string> = { page: "1" };
		for (const col of filterColumns) {
			const key = col.filterKey || `filter_${col.key}`;
			updates[key] = "";
		}
		updateParams(updates);
	}

	function toggleSelectAll() {
		if (selectedIds.size === data.rows.length) {
			setSelectedIds(new Set());
		} else {
			setSelectedIds(new Set(data.rows.map((r) => r.id)));
		}
	}

	function toggleSelect(id: number | string) {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	async function handleBulkAction(action: string) {
		if (
			selectedIds.size === 0 ||
			!onBulkAction ||
			bulkLock.current ||
			isPending
		)
			return;
		const definition = bulkActions?.find((item) => item.value === action);
		if (
			definition?.variant === "destructive" &&
			!window.confirm(
				t("confirmBulk", { action: definition.label, count: selectedIds.size }),
			)
		)
			return;
		bulkLock.current = true;
		setBulkBusy(true);
		try {
			await onBulkAction(action, Array.from(selectedIds));
			setSelectedIds(new Set());
			router.refresh();
		} catch {
			toast.error(t("bulkError"));
		} finally {
			bulkLock.current = false;
			setBulkBusy(false);
		}
	}

	function getSortIcon(key: string) {
		if (currentSort !== key) return <ArrowUpDown className="h-3 w-3" />;
		return currentOrder === "asc" ? (
			<ArrowUp className="h-3 w-3" />
		) : (
			<ArrowDown className="h-3 w-3" />
		);
	}

	function isPresetActive(preset: DataTablePreset): boolean {
		return Object.entries(preset.params).every(
			([k, v]) => (searchParams.get(k) ?? "") === v,
		);
	}

	function applyPreset(preset: DataTablePreset) {
		// Apply (or toggle off) the preset by overwriting only its keys + reset page.
		const updates: Record<string, string> = { page: "1" };
		if (isPresetActive(preset)) {
			for (const k of Object.keys(preset.params)) updates[k] = "";
		} else {
			Object.assign(updates, preset.params);
		}
		updateParams(updates);
	}

	return (
		<div className="space-y-4 min-w-0" aria-busy={isPending || bulkBusy}>
			{/* Preset filter chips */}
			{presets && presets.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5">
					{presets.map((preset) => {
						const active = isPresetActive(preset);
						return (
							<button
								key={preset.label}
								type="button"
								onClick={() => applyPreset(preset)}
								className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
									active
										? "border-primary bg-primary text-primary-foreground"
										: "border-border bg-background hover:bg-accent"
								}`}
							>
								{preset.label}
								{active && <X className="h-3 w-3" />}
							</button>
						);
					})}
				</div>
			)}

			{/* Toolbar */}
			<div className="flex flex-wrap items-center gap-3">
				<div className="relative flex-1 min-w-[200px] max-w-sm">
					<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder={searchPlaceholder ?? t("search")}
						aria-label={searchPlaceholder ?? t("search")}
						value={searchValue}
						onChange={(e) => handleSearch(e.target.value)}
						style={{ paddingLeft: 36 }}
						className="pl-9"
					/>
				</div>

				<TableSavedViews
					path={pathname}
					query={searchParams.toString()}
					hidden={[...hiddenColumns]}
					onApply={(view) => {
						setHiddenColumns(
							() =>
								new Set(
									view.state.hidden.filter((key) =>
										columns.some((column) => column.key === key),
									),
								),
						);
						const params = new URLSearchParams(view.state.params);
						params.set("page", "1");
						startTransition(() =>
							router.replace(`${pathname}?${params.toString()}`, {
								scroll: false,
							}),
						);
					}}
				/>

				{/* Column Filters */}
				{filterColumns.length > 0 && (
					<Popover>
						<PopoverTrigger asChild>
							<Button variant="outline" size="sm" className="gap-2">
								<Filter className="h-4 w-4" />
								{t("filters")}
								{activeFilterCount > 0 && (
									<Badge
										variant="secondary"
										className="ml-1 h-5 w-5 rounded-full p-0 text-xs flex items-center justify-center"
									>
										{activeFilterCount}
									</Badge>
								)}
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-72" align="start">
							<div className="space-y-3">
								<div className="flex items-center justify-between">
									<h4 className="text-sm font-medium">{t("filters")}</h4>
									{activeFilterCount > 0 && (
										<Button
											variant="ghost"
											size="sm"
											className="h-7 px-2 text-xs"
											onClick={clearAllFilters}
										>
											{t("clearAll")}
										</Button>
									)}
								</div>
								{filterColumns.map((col) => {
									const key = col.filterKey || `filter_${col.key}`;
									const currentValue = searchParams.get(key) || "__all__";
									return (
										<div key={col.key} className="space-y-1.5">
											<span className="text-xs font-medium text-muted-foreground">
												{col.label}
											</span>
											<Select
												value={currentValue}
												onValueChange={(v) => handleFilterChange(col, v)}
											>
												<SelectTrigger
													aria-label={col.label}
													className="h-8 text-xs"
												>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="__all__">{t("all")}</SelectItem>
													{col.filterOptions?.map((opt) => (
														<SelectItem key={opt.value} value={opt.value}>
															{opt.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									);
								})}
							</div>
						</PopoverContent>
					</Popover>
				)}

				{/* Active Filter Badges */}
				{activeFilterCount > 0 && (
					<div className="flex flex-wrap items-center gap-1.5">
						{filterColumns.map((col) => {
							const key = col.filterKey || `filter_${col.key}`;
							const val = searchParams.get(key);
							if (!val) return null;
							const opt = col.filterOptions?.find((o) => o.value === val);
							return (
								<Badge key={key} variant="secondary" className="gap-1 pr-1">
									{col.label}: {opt?.label || val}
									<button
										type="button"
										aria-label={t("removeFilter", { name: col.label })}
										onClick={() => handleFilterChange(col, "__all__")}
										className="ml-0.5 rounded-full p-0.5 hover:bg-accent"
									>
										<X className="h-3 w-3" />
									</button>
								</Badge>
							);
						})}
					</div>
				)}

				{/* Column Visibility */}
				<Popover>
					<PopoverTrigger asChild>
						<Button variant="outline" size="sm" className="gap-2">
							<SlidersHorizontal className="h-4 w-4" />
							{t("columns")}
						</Button>
					</PopoverTrigger>
					<PopoverContent className="w-48" align="start">
						<div className="space-y-1">
							<h4 className="text-sm font-medium mb-2">{t("columns")}</h4>
							{columns.map((col) => (
								<div
									key={col.key}
									className="flex items-center gap-2 py-1 text-sm hover:text-foreground"
								>
									<Checkbox
										checked={!hiddenColumns.has(col.key)}
										aria-label={col.label}
										onCheckedChange={(checked) => {
											setHiddenColumns((prev) => {
												const next = new Set(prev);
												if (checked) next.delete(col.key);
												else next.add(col.key);
												return next;
											});
										}}
									/>
									{col.label}
								</div>
							))}
						</div>
					</PopoverContent>
				</Popover>

				<Select
					value={String(data.perPage)}
					onValueChange={handlePerPageChange}
				>
					<SelectTrigger
						aria-label={t("perPage", { count: data.perPage })}
						className="w-[100px]"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{PER_PAGE_OPTIONS.map((n) => (
							<SelectItem key={n} value={String(n)}>
								{t("perPage", { count: n })}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{exportUrl && (
					<Button variant="outline" size="sm" asChild>
						<a href={exportUrl}>
							<Download className="mr-2 h-4 w-4" />
							CSV
						</a>
					</Button>
				)}

				{bulkActions && selectedIds.size > 0 && (
					<div className="flex items-center gap-2">
						<span className="text-sm text-muted-foreground">
							{t("selected", { count: selectedIds.size })}
						</span>
						{bulkActions.map((action) => (
							<Button
								key={action.value}
								variant={action.variant || "default"}
								size="sm"
								disabled={bulkBusy || isPending}
								onClick={() => handleBulkAction(action.value)}
							>
								{action.label}
							</Button>
						))}
					</div>
				)}

				<div className="ml-auto text-sm text-muted-foreground">
					{t("results", { count: data.total })}
				</div>
			</div>

			{/* Table */}
			<div className="rounded-md border overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							{bulkActions && (
								<TableHead className="w-[40px]">
									<Checkbox
										checked={
											selectedIds.size === data.rows.length &&
											data.rows.length > 0
										}
										aria-label={t("selectAll")}
										disabled={isPending || bulkBusy}
										onCheckedChange={toggleSelectAll}
									/>
								</TableHead>
							)}
							{columns
								.filter((col) => !hiddenColumns.has(col.key))
								.map((col) => (
									<TableHead key={col.key}>
										{col.sortable ? (
											<button
												type="button"
												className="flex items-center gap-1 hover:text-foreground"
												onClick={() => handleSort(col.key)}
											>
												{col.label}
												{getSortIcon(col.key)}
											</button>
										) : (
											col.label
										)}
									</TableHead>
								))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.rows.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={
										columns.filter((c) => !hiddenColumns.has(c.key)).length +
										(bulkActions ? 1 : 0)
									}
									className="h-24 text-center text-muted-foreground"
								>
									{t("empty")}
								</TableCell>
							</TableRow>
						) : (
							data.rows.map((row) => (
								<TableRow
									key={row.id}
									className={isPending ? "opacity-50" : undefined}
									data-selected={selectedIds.has(row.id) || undefined}
								>
									{bulkActions && (
										<TableCell>
											<Checkbox
												checked={selectedIds.has(row.id)}
												aria-label={t("selectRow", { id: String(row.id) })}
												disabled={isPending || bulkBusy}
												onCheckedChange={() => toggleSelect(row.id)}
											/>
										</TableCell>
									)}
									{columns
										.filter((col) => !hiddenColumns.has(col.key))
										.map((col) => (
											<TableCell key={col.key}>
												{col.render
													? col.render(
															(row as Record<string, unknown>)[
																col.key
															] as T[keyof T],
															row,
														)
													: String(
															(row as Record<string, unknown>)[col.key] ?? "",
														)}
											</TableCell>
										))}
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{/* Pagination */}
			{data.lastPage > 1 && (
				<div className="flex items-center justify-between">
					<p className="text-sm text-muted-foreground">
						{t("pageOf", { page: data.page, last: data.lastPage })}
					</p>
					<div className="flex items-center gap-1 flex-wrap justify-end">
						<Button
							variant="outline"
							size="icon"
							aria-label={t("previous")}
							disabled={data.page <= 1 || isPending}
							onClick={() => handlePageChange(data.page - 1)}
						>
							<ChevronLeft className="h-4 w-4" />
						</Button>
						{tablePageNumbers(data.page, data.lastPage).map((pageNum) => {
							return (
								<Button
									key={pageNum}
									aria-label={t("page", { page: pageNum })}
									aria-current={pageNum === data.page ? "page" : undefined}
									disabled={isPending}
									variant={pageNum === data.page ? "default" : "outline"}
									size="icon"
									onClick={() => handlePageChange(pageNum)}
								>
									{pageNum}
								</Button>
							);
						})}
						<Button
							variant="outline"
							size="icon"
							aria-label={t("next")}
							disabled={data.page >= data.lastPage || isPending}
							onClick={() => handlePageChange(data.page + 1)}
						>
							<ChevronRight className="h-4 w-4" />
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
