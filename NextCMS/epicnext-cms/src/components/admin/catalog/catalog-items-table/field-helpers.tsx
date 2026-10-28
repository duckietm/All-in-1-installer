"use client";

import { Check, ChevronsUpDown, Star } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// ── Toggle field ──────────────────────────────────────────────

export function ToggleField({
	label,
	checked,
	value,
	onChange,
	disabled,
}: {
	label: string;
	/** Boolean checked state */
	checked?: boolean;
	/** Number or string (0/1 or '0'/'1') — converted to boolean automatically */
	value?: number | string;
	onChange: (v: boolean) => void;
	disabled?: boolean;
}) {
	const id = useId();
	const isChecked = checked ?? (value === 1 || value === "1");
	return (
		<div className="flex items-center justify-between gap-2">
			<Label htmlFor={id} className="text-xs">
				{label}
			</Label>
			<Switch
				id={id}
				checked={isChecked}
				onCheckedChange={onChange}
				disabled={disabled}
				size="sm"
			/>
		</div>
	);
}

// ── Interaction Type Combobox ──────────────────────────────────

export function InteractionTypeCombobox({
	value,
	onChange,
	types,
	disabled,
}: {
	value: string;
	onChange: (v: string) => void;
	types: string[];
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [inputValue, setInputValue] = useState("");

	const filtered = useMemo(() => {
		if (!inputValue.trim()) return types.slice(0, 50);
		const q = inputValue.toLowerCase();
		return types.filter((t) => t.toLowerCase().includes(q)).slice(0, 50);
	}, [types, inputValue]);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					disabled={disabled}
					className="w-full justify-between font-normal h-8 text-sm"
				>
					<span className="truncate">{value || "Select type..."}</span>
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-[--radix-popover-trigger-width] p-0"
				align="start"
			>
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search or type custom..."
						value={inputValue}
						onValueChange={setInputValue}
					/>
					<CommandList>
						<CommandEmpty>
							{inputValue.trim() ? (
								<button
									type="button"
									className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent rounded"
									onClick={() => {
										onChange(inputValue.trim());
										setOpen(false);
										setInputValue("");
									}}
								>
									Use &quot;{inputValue.trim()}&quot;
								</button>
							) : (
								"No types found."
							)}
						</CommandEmpty>
						<CommandGroup>
							{filtered.map((t) => (
								<CommandItem
									key={t}
									value={t}
									onSelect={() => {
										onChange(t);
										setOpen(false);
										setInputValue("");
									}}
								>
									<Check
										className={cn(
											"mr-2 h-4 w-4",
											value === t ? "opacity-100" : "opacity-0",
										)}
									/>
									<span className="truncate">{t}</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

// ── Move Page Combobox with smart suggestions ─────────────────

export function MovePageCombobox({
	value,
	onChange,
	pages,
	currentPageId,
	suggestedPageIds,
	disabled = false,
	labels,
}: {
	value: number | null;
	onChange: (id: number | null) => void;
	pages: { id: number; caption: string }[];
	currentPageId: number;
	/** Page IDs to show first as suggestions (from move-suggestions.ts) */
	suggestedPageIds?: number[];
	disabled?: boolean;
	labels?: {
		placeholder: string;
		search: string;
		empty: string;
		suggested: string;
		all: string;
	};
}) {
	const [open, setOpen] = useState(false);

	const options = useMemo(
		() => pages.filter((p) => p.id !== currentPageId),
		[pages, currentPageId],
	);

	const selectedPage = value ? pages.find((p) => p.id === value) : null;

	// Build suggested pages list
	const suggested = useMemo(() => {
		if (!suggestedPageIds?.length) return [];
		const pageMap = new Map(options.map((p) => [p.id, p]));
		return suggestedPageIds.map((id) => pageMap.get(id)).filter(Boolean) as {
			id: number;
			caption: string;
		}[];
	}, [suggestedPageIds, options]);

	// Non-suggested pages (exclude those already in suggestions)
	const suggestedSet = useMemo(
		() => new Set(suggested.map((s) => s.id)),
		[suggested],
	);
	const remaining = useMemo(
		() => options.filter((p) => !suggestedSet.has(p.id)),
		[options, suggestedSet],
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					disabled={disabled}
					aria-expanded={open}
					className="w-full justify-between font-normal"
				>
					{selectedPage ? (
						<span className="truncate">
							<span className="text-muted-foreground font-mono text-xs mr-1.5">
								#{selectedPage.id}
							</span>
							{selectedPage.caption}
						</span>
					) : (
						<span className="text-muted-foreground">
							{labels?.placeholder ?? "Select target page..."}
						</span>
					)}
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-[--radix-popover-trigger-width] p-0"
				align="start"
			>
				<Command>
					<CommandInput placeholder={labels?.search ?? "Search pages..."} />
					<CommandList>
						<CommandEmpty>{labels?.empty ?? "No page found."}</CommandEmpty>

						{/* Suggested pages */}
						{suggested.length > 0 && (
							<CommandGroup heading={labels?.suggested ?? "Suggested"}>
								{suggested.map((page) => (
									<CommandItem
										key={`s-${page.id}`}
										value={`${page.id} ${page.caption}`}
										onSelect={() => {
											onChange(page.id);
											setOpen(false);
										}}
									>
										<Check
											className={cn(
												"mr-2 h-4 w-4",
												value === page.id ? "opacity-100" : "opacity-0",
											)}
										/>
										<Star className="mr-1.5 h-3 w-3 text-[var(--admin-warning)]" />
										<span className="text-muted-foreground font-mono text-xs mr-1.5">
											#{page.id}
										</span>
										<span className="truncate">{page.caption}</span>
									</CommandItem>
								))}
							</CommandGroup>
						)}

						{/* All pages */}
						<CommandGroup
							heading={
								suggested.length > 0 ? (labels?.all ?? "All pages") : undefined
							}
						>
							{remaining.map((page) => (
								<CommandItem
									key={page.id}
									value={`${page.id} ${page.caption}`}
									onSelect={() => {
										onChange(page.id);
										setOpen(false);
									}}
								>
									<Check
										className={cn(
											"mr-2 h-4 w-4",
											value === page.id ? "opacity-100" : "opacity-0",
										)}
									/>
									<span className="text-muted-foreground font-mono text-xs mr-1.5">
										#{page.id}
									</span>
									<span className="truncate">{page.caption}</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
