"use client";

import { ImageIcon, Loader2, Search, X } from "lucide-react";
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
import { catalogueAssetUrl } from "@/lib/catalog-assets";
import { cn } from "@/lib/utils";

interface CatalogImagePickerProps {
	value: string;
	onChange: (name: string) => void;
	/** Filter: 'header' | 'teaser' | 'all' */
	type?: "header" | "teaser" | "all";
	disabled?: boolean;
	label?: string;
}

const PAGE_SIZE = 80;

export function CatalogImagePicker({
	value,
	onChange,
	type = "all",
	disabled,
	label,
}: CatalogImagePickerProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [debounced, setDebounced] = useState("");
	const [images, setImages] = useState<string[]>([]);
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

	const fetchImages = useCallback(
		async (nextOffset: number, replace: boolean) => {
			setLoading(true);
			try {
				const params = new URLSearchParams({
					limit: String(PAGE_SIZE),
					offset: String(nextOffset),
					type,
				});
				if (debounced) params.set("search", debounced);
				const res = await fetch(`/cms_api/admin/catalog/images?${params}`);
				if (!res.ok) throw new Error();
				const data = await res.json();
				const fetched: string[] = data.images ?? [];
				setTotal(data.total ?? 0);
				setHasMore(nextOffset + fetched.length < (data.total ?? 0));
				setImages((prev) => (replace ? fetched : [...prev, ...fetched]));
				setOffset(nextOffset + fetched.length);
			} catch {
				// ignore
			} finally {
				setLoading(false);
			}
		},
		[debounced, type],
	);

	// Reset and fetch on open / search change
	// biome-ignore lint/correctness/useExhaustiveDependencies: debounced is the search term; refetching on its change is intended
	useEffect(() => {
		if (!open) return;
		setImages([]);
		setOffset(0);
		setHasMore(true);
		fetchImages(0, true);
		if (scrollRef.current) scrollRef.current.scrollTop = 0;
		// debounced drives the search term, so a changed query must refetch.
	}, [open, fetchImages, debounced]);

	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el || loading || !hasMore) return;
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
			fetchImages(offset, false);
		}
	}, [loading, hasMore, offset, fetchImages]);

	const handleSelect = (name: string) => {
		onChange(name);
		setOpen(false);
	};

	const handleClear = () => {
		onChange("");
		setOpen(false);
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Button
				type="button"
				variant="outline"
				disabled={disabled}
				className="h-auto w-full justify-start gap-2 px-3 py-2"
				onClick={() => setOpen(true)}
			>
				{value ? (
					<CatalogImageThumb name={value} size={40} />
				) : (
					<div className="flex h-10 w-16 items-center justify-center rounded bg-muted">
						<ImageIcon className="h-4 w-4 text-muted-foreground" />
					</div>
				)}
				<div className="min-w-0 text-left">
					<p className="text-xs font-medium truncate">
						{label ||
							(type === "header"
								? "Headline image"
								: type === "teaser"
									? "Teaser image"
									: "Image")}
					</p>
					<p className="text-[11px] text-muted-foreground truncate font-mono">
						{value || "None selected"}
					</p>
				</div>
			</Button>
			<DialogContent className="max-w-4xl">
				<DialogHeader>
					<DialogTitle>
						{type === "header"
							? "Select Headline Image"
							: type === "teaser"
								? "Select Teaser Image"
								: "Select Catalog Image"}
					</DialogTitle>
				</DialogHeader>

				<div className="flex items-center gap-2">
					<div className="relative flex-1">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search by filename..."
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
						{total} images
					</Badge>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={handleClear}
					>
						Clear
					</Button>
				</div>

				<div
					ref={scrollRef}
					onScroll={handleScroll}
					className="h-[480px] overflow-y-auto rounded-md border bg-muted/20 p-2"
				>
					{images.length === 0 && !loading && (
						<p className="py-16 text-center text-sm text-muted-foreground">
							No images found
						</p>
					)}
					<div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
						{images.map((name) => (
							<button
								key={name}
								type="button"
								onClick={() => handleSelect(name)}
								className={cn(
									"group relative flex flex-col overflow-hidden rounded-md border bg-card transition-colors hover:border-primary hover:shadow-sm",
									value === name && "border-primary ring-2 ring-primary/30",
								)}
								title={name}
							>
								<div className="flex h-24 items-center justify-center bg-gradient-to-b from-muted/30 to-muted/60 p-1">
									<CatalogImageThumb name={name} size={80} />
								</div>
								<div className="border-t bg-background/95 px-2 py-1">
									<p className="truncate font-mono text-[10px] text-muted-foreground group-hover:text-foreground">
										{name}
									</p>
								</div>
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

// ── Thumbnail with gif/png fallback ─────────────────────────────

function CatalogImageThumb({
	name,
	size = 60,
}: {
	name: string;
	size?: number;
}) {
	const [error, setError] = useState(0);

	// Reset error state when name changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: name is a prop; the reset is meant to follow it
	useEffect(() => setError(0), [name]);

	if (!name || error >= 2) {
		return (
			<div
				className="flex items-center justify-center rounded bg-muted"
				style={{ width: size, height: size * 0.6 }}
			>
				<ImageIcon className="h-4 w-4 text-muted-foreground" />
			</div>
		);
	}

	// Try .png first, fallback to .gif
	const src = catalogueAssetUrl(name, error === 0 ? "png" : "gif");

	return (
		<img
			src={src}
			alt={name}
			className="object-contain"
			style={{
				imageRendering: "pixelated",
				maxWidth: size,
				maxHeight: size * 0.75,
			}}
			onError={() => setError((e) => e + 1)}
		/>
	);
}
