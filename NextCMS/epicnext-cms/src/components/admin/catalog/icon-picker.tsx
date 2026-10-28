"use client";

import { Loader2, Package, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { logger } from "@/lib/browser-log";
import { catalogueIconUrl } from "@/lib/catalog-assets";
import { cn } from "@/lib/utils";

interface IconPickerProps {
	value: number;
	onChange: (iconImage: number) => void;
	disabled?: boolean;
	/** Optional trigger override. If not provided, a default button is rendered. */
	children?: React.ReactNode;
}

const PAGE_SIZE = 120;

export function IconPicker({
	value,
	onChange,
	disabled,
	children,
}: IconPickerProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [debounced, setDebounced] = useState("");
	const [icons, setIcons] = useState<number[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(false);
	const [offset, setOffset] = useState(0);
	const [hasMore, setHasMore] = useState(true);
	const scrollRef = useRef<HTMLDivElement>(null);

	// Debounce search
	useEffect(() => {
		const t = setTimeout(() => setDebounced(search.trim()), 250);
		return () => clearTimeout(t);
	}, [search]);

	const fetchIcons = useCallback(
		async (nextOffset: number, replace: boolean) => {
			setLoading(true);
			try {
				const params = new URLSearchParams({
					limit: String(PAGE_SIZE),
					offset: String(nextOffset),
				});
				if (debounced) params.set("search", debounced);
				const res = await fetch(`/cms_api/admin/catalog/icons?${params}`);
				if (!res.ok) throw new Error("Failed to load icons");
				const data = await res.json();
				const fetched: number[] = data.icons ?? [];
				setTotal(data.total ?? 0);
				setHasMore(nextOffset + fetched.length < (data.total ?? 0));
				setIcons((prev) => (replace ? fetched : [...prev, ...fetched]));
				setOffset(nextOffset + fetched.length);
			} catch (err) {
				logger.error("[IconPicker] icon load failed", {
					err: err as Error,
				});
			} finally {
				setLoading(false);
			}
		},
		[debounced],
	);

	// Reset and fetch on open / search change
	useEffect(() => {
		if (!open) return;
		setIcons([]);
		setOffset(0);
		setHasMore(true);
		fetchIcons(0, true);
		if (scrollRef.current) scrollRef.current.scrollTop = 0;
	}, [open, fetchIcons]);

	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el || loading || !hasMore) return;
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
			fetchIcons(offset, false);
		}
	}, [loading, hasMore, offset, fetchIcons]);

	const handleSelect = (id: number) => {
		onChange(id);
		setOpen(false);
	};

	const handleClear = () => {
		onChange(0);
		setOpen(false);
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			{children ? (
				<button
					type="button"
					disabled={disabled}
					onClick={() => setOpen(true)}
					className="contents"
				>
					{children}
				</button>
			) : (
				<Button
					type="button"
					variant="outline"
					disabled={disabled}
					className="h-auto gap-2 px-3 py-2"
					onClick={() => setOpen(true)}
				>
					<IconPreview iconImage={value} size={24} />
					<span className="font-mono text-xs text-muted-foreground">
						{value > 0 ? `#${value}` : "None"}
					</span>
				</Button>
			)}
			<DialogContent className="max-w-3xl">
				<DialogHeader>
					<DialogTitle>Select Catalog Icon</DialogTitle>
				</DialogHeader>

				<div className="flex items-center gap-2">
					<div className="relative flex-1">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search by icon ID..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="pl-9 pr-9"
							autoFocus
						/>
						{search && (
							<button
								type="button"
								onClick={() => setSearch("")}
								className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
							>
								<X className="h-4 w-4" />
							</button>
						)}
					</div>
					<Badge variant="secondary" className="shrink-0 tabular-nums">
						{total} icons
					</Badge>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={handleClear}
					>
						<Package className="mr-1.5 h-3.5 w-3.5" />
						None
					</Button>
				</div>

				<div
					ref={scrollRef}
					onScroll={handleScroll}
					className="h-[420px] overflow-y-auto rounded-md border bg-muted/20 p-2"
				>
					{icons.length === 0 && !loading && (
						<p className="py-16 text-center text-sm text-muted-foreground">
							No icons found
						</p>
					)}
					<div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1.5">
						{icons.map((id) => (
							<button
								key={id}
								type="button"
								onClick={() => handleSelect(id)}
								className={cn(
									"group relative flex aspect-square items-center justify-center rounded border bg-card p-1 transition-colors hover:border-primary hover:bg-accent",
									value === id && "border-primary ring-2 ring-primary/30",
								)}
								title={`Icon #${id}`}
							>
								<IconPreview iconImage={id} size={36} />
								<span className="absolute bottom-0 left-0 right-0 truncate bg-background/80 px-0.5 text-center font-mono text-[9px] leading-tight text-muted-foreground opacity-0 group-hover:opacity-100">
									{id}
								</span>
							</button>
						))}
					</div>
					{loading && (
						<div className="flex items-center justify-center py-4">
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

// ── Small preview component (inlined to avoid circular imports) ───────

function IconPreview({
	iconImage,
	size = 24,
}: {
	iconImage: number;
	size?: number;
}) {
	const [error, setError] = useState(0);
	// Clear the previous load failure when the icon changes, otherwise a
	// placeholder sticks to the next image too.
	// biome-ignore lint/correctness/useExhaustiveDependencies: iconImage is a prop; the reset is meant to follow it
	useEffect(() => setError(0), [iconImage]);

	// A few icons ship only as `.gif`; retry once before falling back.
	if (error >= 2 || iconImage <= 0) {
		return (
			<Package
				className="shrink-0 text-muted-foreground"
				style={{ width: size, height: size }}
			/>
		);
	}

	return (
		<img
			src={catalogueIconUrl(iconImage, error === 0 ? "png" : "gif")}
			alt=""
			width={size}
			height={size}
			className="shrink-0 object-contain"
			style={{ imageRendering: "pixelated", maxWidth: size, maxHeight: size }}
			onError={() => setError((e) => e + 1)}
		/>
	);
}
