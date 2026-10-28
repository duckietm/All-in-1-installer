"use client";

import {
	ChevronLeft,
	ChevronRight,
	ChevronsLeft,
	ChevronsRight,
	Loader2,
	RotateCcw,
	Save,
	Search,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveEmulatorSettings } from "@/actions/emulator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useServerAction } from "@/hooks/use-server-action";

interface Setting {
	key: string;
	value: string;
}

interface GroupSummary {
	name: string;
	count: number;
}

interface EmulatorSettingsFormProps {
	settings: Setting[];
	pagination: {
		total: number;
		page: number;
		perPage: number;
		lastPage: number;
	};
	search: string;
	allGroups?: GroupSummary[];
	activeGroup?: string;
}

const PER_PAGE_OPTIONS = [25, 50, 100, 200] as const;

function getSettingGroup(key: string): string {
	const parts = key.split(".");
	return parts.length > 1 ? parts[0] : "general";
}

const GROUP_BORDER_COLORS: Record<string, string> = {
	hotel: "border-l-blue-500",
	navigator: "border-l-green-500",
	catalog: "border-l-purple-500",
	room: "border-l-orange-500",
	camera: "border-l-pink-500",
	commands: "border-l-cyan-500",
	wordfilter: "border-l-red-500",
	pet: "border-l-yellow-500",
	matchmaking: "border-l-indigo-500",
	message: "border-l-emerald-500",
	notification: "border-l-fuchsia-500",
	general: "border-l-gray-400",
};

export function EmulatorSettingsForm({
	settings,
	pagination,
	search,
	allGroups,
	activeGroup,
}: EmulatorSettingsFormProps) {
	const router = useRouter();
	const searchParams = useSearchParams();

	// `values` only contains overrides typed by the user. Display falls back
	// to `setting.value`. `originalValues` accumulates the on-disk values for
	// every setting we have ever rendered (across pages) so we can detect when
	// an edit returns to its original state.
	const [values, setValues] = useState<Record<string, string>>({});
	const [originalValues, setOriginalValues] = useState<Record<string, string>>(
		{},
	);
	const [changedKeys, setChangedKeys] = useState<Set<string>>(new Set());
	const [isNavigating, startTransition] = useTransition();
	const { run, isPending } = useServerAction();
	const [searchValue, setSearchValue] = useState(search);

	useEffect(() => {
		setOriginalValues((prev) => {
			let dirty = false;
			const next = { ...prev };
			for (const s of settings) {
				if (!(s.key in next)) {
					next[s.key] = s.value;
					dirty = true;
				}
			}
			return dirty ? next : prev;
		});
	}, [settings]);

	// Prefer the canonical list passed by the server (covers all groups, not
	// just those visible on the current page). Fall back to deriving from the
	// current page when the prop is omitted.
	const groupSummary = useMemo<GroupSummary[]>(() => {
		if (allGroups && allGroups.length > 0) return allGroups;
		const map = new Map<string, number>();
		for (const s of settings) {
			const g = getSettingGroup(s.key);
			map.set(g, (map.get(g) ?? 0) + 1);
		}
		return Array.from(map.entries())
			.map(([name, count]) => ({ name, count }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}, [allGroups, settings]);

	function toggleGroup(name: string) {
		updateParams({
			group: activeGroup === name ? "" : name,
			page: "1",
		});
	}

	function getDisplayValue(setting: Setting): string {
		return values[setting.key] ?? setting.value;
	}

	function updateValue(key: string, val: string) {
		setValues((prev) => ({ ...prev, [key]: val }));
		setChangedKeys((prev) => {
			const next = new Set(prev);
			if (originalValues[key] !== undefined && val === originalValues[key]) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	}

	function revertChange(key: string) {
		setValues((prev) => {
			const next = { ...prev };
			delete next[key];
			return next;
		});
		setChangedKeys((prev) => {
			const next = new Set(prev);
			next.delete(key);
			return next;
		});
	}

	function updateParams(updates: Record<string, string>) {
		const params = new URLSearchParams(searchParams.toString());
		for (const [key, value] of Object.entries(updates)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		startTransition(() => {
			router.push(`?${params.toString()}`);
		});
	}

	function handleSearch(e: React.FormEvent) {
		e.preventDefault();
		updateParams({ search: searchValue, page: "1" });
	}

	function handleSaveAll() {
		if (changedKeys.size === 0) {
			toast.info("No changes to save.");
			return;
		}
		const changedSettings: Record<string, string> = {};
		for (const key of changedKeys) {
			changedSettings[key] = values[key];
		}
		const count = changedKeys.size;
		run(() => saveEmulatorSettings({ settings: changedSettings }), {
			successMessage: `${count} setting(s) saved and synced with emulator.`,
			onSuccess: () => {
				setChangedKeys(new Set());
				setValues({});
				// Refresh server data so the on-disk values reflect the save and the
				// originalValues snapshot rebuilds on next render.
				setOriginalValues({});
				router.refresh();
			},
		});
	}

	function jumpToPage(raw: string) {
		const n = parseInt(raw, 10);
		if (!Number.isFinite(n)) return;
		const clamped = Math.max(1, Math.min(pagination.lastPage, n));
		if (clamped !== pagination.page) updateParams({ page: String(clamped) });
	}

	return (
		<div className="space-y-4">
			{/* Toolbar */}
			<div className="flex flex-wrap items-center gap-3">
				<form onSubmit={handleSearch} className="flex gap-2 flex-1 max-w-md">
					<div className="relative flex-1">
						<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							placeholder="Search settings..."
							value={searchValue}
							onChange={(e) => setSearchValue(e.target.value)}
							className="pl-9"
						/>
					</div>
					<Button type="submit" variant="outline" size="sm">
						Search
					</Button>
				</form>

				<div className="ml-auto flex items-center gap-3">
					<span className="text-sm text-muted-foreground">
						{pagination.total} settings
					</span>
					{changedKeys.size > 0 && (
						<Badge variant="secondary" className="gap-1">
							{changedKeys.size} changed
						</Badge>
					)}
					<Button
						onClick={handleSaveAll}
						disabled={isPending || changedKeys.size === 0}
						size="sm"
					>
						{isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Save className="mr-2 h-4 w-4" />
						)}
						Save & Sync
					</Button>
				</div>
			</div>

			{/* Group summary chips — click to toggle group filter */}
			{groupSummary.length > 1 && (
				<div className="flex flex-wrap gap-1.5 items-center">
					{activeGroup && (
						<button
							type="button"
							onClick={() => toggleGroup(activeGroup)}
							className="text-[11px] underline text-muted-foreground hover:text-foreground"
						>
							clear
						</button>
					)}
					{groupSummary.map(({ name, count }) => {
						const isActive = activeGroup === name;
						const color = (
							GROUP_BORDER_COLORS[name] || GROUP_BORDER_COLORS.general
						).replace("border-l-", "bg-");
						return (
							<button
								key={name}
								type="button"
								onClick={() => toggleGroup(name)}
								className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-mono transition-colors ${
									isActive
										? "border-primary bg-primary/10 text-foreground"
										: "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent"
								}`}
								title={isActive ? `Rimuovi filtro: ${name}` : `Filtra: ${name}`}
								disabled={isNavigating}
							>
								<span
									className={`inline-block w-2 h-2 rounded-full ${color}`}
								/>
								{name}
								<span className="text-muted-foreground">{count}</span>
							</button>
						);
					})}
				</div>
			)}

			{/* Settings list — flat rows with always-on inline editing */}
			<div className="rounded-md border bg-card divide-y">
				{settings.length === 0 ? (
					<div className="px-4 py-8 text-center text-sm text-muted-foreground">
						No settings found.
					</div>
				) : (
					settings.map((setting) => {
						const group = getSettingGroup(setting.key);
						const borderColor =
							GROUP_BORDER_COLORS[group] || GROUP_BORDER_COLORS.general;
						const isChanged = changedKeys.has(setting.key);
						const display = getDisplayValue(setting);
						return (
							<div
								key={setting.key}
								className={`flex items-center gap-3 px-3 py-1.5 border-l-4 ${borderColor} ${
									isChanged
										? "bg-[var(--admin-warning-subtle)] dark:bg-[var(--admin-warning-subtle)]"
										: ""
								}`}
							>
								<code
									className="text-xs font-mono text-muted-foreground w-[280px] flex-shrink-0 truncate"
									title={setting.key}
								>
									{setting.key}
								</code>
								<Input
									value={display}
									onChange={(e) => updateValue(setting.key, e.target.value)}
									className={`flex-1 h-8 text-xs font-mono ${
										isChanged ? "border-[var(--admin-warning-border)]" : ""
									}`}
								/>
								{isChanged && (
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7 shrink-0"
										title="Revert"
										onClick={() => revertChange(setting.key)}
									>
										<RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
									</Button>
								)}
							</div>
						);
					})
				)}
			</div>

			{/* Pagination + per-page selector */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<span>Per page</span>
					<Select
						value={String(pagination.perPage)}
						onValueChange={(v) => updateParams({ perPage: v, page: "1" })}
					>
						<SelectTrigger size="sm" className="w-[80px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PER_PAGE_OPTIONS.map((n) => (
								<SelectItem key={n} value={String(n)}>
									{n}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<span className="ml-2">
						{pagination.total === 0
							? "0 results"
							: `${(pagination.page - 1) * pagination.perPage + 1}–${Math.min(
									pagination.page * pagination.perPage,
									pagination.total,
								)} of ${pagination.total}`}
					</span>
				</div>

				<div className="flex items-center gap-1">
					<Button
						variant="outline"
						size="icon"
						disabled={pagination.page <= 1 || isNavigating}
						onClick={() => updateParams({ page: "1" })}
						title="First page"
					>
						<ChevronsLeft className="h-4 w-4" />
					</Button>
					<Button
						variant="outline"
						size="icon"
						disabled={pagination.page <= 1 || isNavigating}
						onClick={() => updateParams({ page: String(pagination.page - 1) })}
					>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<div className="flex items-center gap-1 mx-1 text-sm">
						<Input
							type="number"
							min={1}
							max={pagination.lastPage}
							defaultValue={pagination.page}
							key={pagination.page}
							onBlur={(e) => jumpToPage(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter")
									jumpToPage((e.target as HTMLInputElement).value);
							}}
							className="h-8 w-14 text-center text-xs"
						/>
						<span className="text-muted-foreground">
							of {pagination.lastPage}
						</span>
					</div>
					<Button
						variant="outline"
						size="icon"
						disabled={pagination.page >= pagination.lastPage || isNavigating}
						onClick={() => updateParams({ page: String(pagination.page + 1) })}
					>
						<ChevronRight className="h-4 w-4" />
					</Button>
					<Button
						variant="outline"
						size="icon"
						disabled={pagination.page >= pagination.lastPage || isNavigating}
						onClick={() => updateParams({ page: String(pagination.lastPage) })}
						title="Last page"
					>
						<ChevronsRight className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</div>
	);
}
