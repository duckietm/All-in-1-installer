"use client";
import { Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { getBulkOfferDestinations } from "@/actions/catalog-bulk";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { requestCatalogNavigation } from "../client/use-catalog-navigation";
import { useLatestRequest } from "../client/use-latest-request";
import {
	type CatalogSearchResult,
	type SearchCatalogKind,
	validSearchQuery,
} from "../domain/search";
import { BulkOfferEditor } from "./bulk-offer-editor";
export function CatalogSearch({
	catalogType = "normal",
	canEdit = false,
	onNavigate,
	autoFocus = false,
}: {
	catalogType?: SearchCatalogKind;
	canEdit?: boolean;
	onNavigate?: (result: CatalogSearchResult) => void | Promise<void>;
	autoFocus?: boolean;
}) {
	const t = useTranslations("pages.admin.catalog.workspace");
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<CatalogSearchResult[]>([]);
	const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
		"idle",
	);
	const requests = useLatestRequest();
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);
	const bulk = useTranslations("pages.admin.catalog.bulk");
	const router = useRouter();
	const [selected, setSelected] = useState<Set<number>>(new Set());
	const [pages, setPages] = useState<{ id: number; caption: string }[] | null>(
		null,
	);
	const [destinationsLoading, setDestinationsLoading] = useState(false);
	const [selectionError, setSelectionError] = useState<string | null>(null);
	const destinationRequest = useRef(0);
	const destinationBusy = useRef(false);
	const [refreshKey, setRefreshKey] = useState(0);
	// Catalog switches invalidate the selection and destination requests.
	// biome-ignore lint/correctness/useExhaustiveDependencies: a catalog switch is exactly what should reset this
	useEffect(() => {
		destinationRequest.current += 1;
		destinationBusy.current = false;
		setSelected(new Set());
		setPages(null);
		setDestinationsLoading(false);
		setSelectionError(null);
		return () => {
			destinationRequest.current += 1;
		};
	}, [catalogType]);
	async function loadDestinations() {
		if (destinationBusy.current) return;
		destinationBusy.current = true;
		const request = ++destinationRequest.current;
		setDestinationsLoading(true);
		setSelectionError(null);
		try {
			const result = await getBulkOfferDestinations(catalogType);
			if (request !== destinationRequest.current) return;
			if (!result.ok) {
				setSelectionError(result.error);
				return;
			}
			setPages(result.data.pages);
		} catch {
			if (request === destinationRequest.current)
				setSelectionError(bulk("requestFailed"));
		} finally {
			if (request === destinationRequest.current) {
				destinationBusy.current = false;
				setDestinationsLoading(false);
			}
		}
	}
	function mayEdit() {
		if (requestCatalogNavigation()) return true;
		setSelectionError(bulk("disabledReason"));
		return false;
	}
	function toggleOffer(id: number) {
		if (!mayEdit()) return;
		setSelected((previous) => {
			const next = new Set(previous);
			if (next.has(id)) next.delete(id);
			else if (next.size < 500) next.add(id);
			return next;
		});
		if (!pages) void loadDestinations();
	}
	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-runs the query after a bulk edit
	useEffect(() => {
		const request = requests.start();
		setResults([]);
		if (!validSearchQuery(query)) {
			setStatus("idle");
			return () => requests.cancel();
		}
		setStatus("loading");
		const timer = setTimeout(async () => {
			try {
				const params = new URLSearchParams({
					q: query.trim(),
					catalog: catalogType,
				});
				const response = await fetch(`/api/admin/catalog/search?${params}`, {
					signal: request.signal,
				});
				if (!response.ok) throw Error("Search failed");
				const data = await response.json();
				if (!request.isCurrent()) return;
				setResults(data.results);
				setStatus("ready");
			} catch {
				if (request.isCurrent()) setStatus("error");
			}
		}, 250);
		return () => {
			clearTimeout(timer);
			requests.cancel();
		};
		// refreshKey re-runs the query after a bulk edit changed rows that this
		// search would otherwise keep showing as stale.
	}, [query, catalogType, requests, refreshKey]);
	return (
		<section
			aria-label={t("globalSearch")}
			className="min-w-0 space-y-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-[var(--admin-text)]"
		>
			<div className="flex min-w-0 items-center gap-2">
				<Search
					aria-hidden
					className="h-4 w-4 shrink-0 text-muted-foreground"
				/>
				<Input
					ref={inputRef}
					aria-label={t("globalSearch")}
					placeholder={t("searchPlaceholder")}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					maxLength={100}
					className="min-w-0"
				/>
			</div>
			{canEdit && selected.size > 0 && (
				<div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
					<span className="text-sm">
						{bulk("selectedCount", { count: selected.size })}
					</span>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setSelected(new Set())}
					>
						{bulk("clearSelection")}
					</Button>
					{pages ? (
						<BulkOfferEditor
							ids={[...selected]}
							allPages={pages}
							catalog={catalogType}
							beforeEdit={mayEdit}
							onApplied={() => {
								setSelected(new Set());
								setRefreshKey((value) => value + 1);
								router.refresh();
							}}
						/>
					) : (
						<Button
							variant="outline"
							size="sm"
							disabled={destinationsLoading}
							onClick={() => void loadDestinations()}
						>
							{destinationsLoading && (
								<Loader2 className="mr-2 size-4 animate-spin" />
							)}
							{bulk(
								destinationsLoading
									? "loadingDestinations"
									: "retryDestinations",
							)}
						</Button>
					)}
				</div>
			)}
			{selectionError && (
				<p role="alert" className="text-sm text-[var(--admin-error)]">
					{selectionError}
				</p>
			)}
			<div aria-live="polite">
				{status === "loading" && (
					<p className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 aria-hidden className="h-4 w-4 animate-spin" />
						{t("searching")}
					</p>
				)}
				{status === "error" && (
					<p role="alert" className="text-sm text-[var(--admin-error)]">
						{t("searchFailed")}
					</p>
				)}
				{status === "ready" && results.length === 0 && (
					<p className="text-sm text-muted-foreground">
						{t("searchNoResults")}
					</p>
				)}
			</div>
			{results.length > 0 && (
				<ul className="max-h-80 overflow-y-auto divide-y divide-[var(--admin-border)]">
					{results.map((result) => (
						<li
							key={result.kind + result.id}
							className="flex items-center gap-2"
						>
							{canEdit &&
								catalogType === "normal" &&
								result.kind === "offer" && (
									<Checkbox
										aria-label={bulk("selectOffer", {
											name: result.caption,
											id: result.id,
										})}
										checked={selected.has(result.id)}
										disabled={selected.size >= 500 && !selected.has(result.id)}
										onCheckedChange={() => toggleOffer(result.id)}
									/>
								)}
							<Link
								href={result.href}
								onClick={(event) => {
									if (
										onNavigate &&
										!event.ctrlKey &&
										!event.metaKey &&
										!event.shiftKey &&
										!event.altKey
									) {
										event.preventDefault();
										void onNavigate(result);
									}
								}}
								className="block min-w-0 flex-1 rounded px-2 py-2 hover:bg-[var(--admin-canvas)] focus-visible:outline-2"
							>
								<div className="flex flex-wrap items-center gap-2 text-sm">
									<span className="text-xs text-muted-foreground">
										{t(result.kind)}
									</span>
									<span className="font-medium break-words text-[var(--admin-text)]">
										{result.caption}
									</span>
									<span className="text-xs text-muted-foreground">
										#{result.id}
									</span>
								</div>
								<p className="break-words text-xs text-muted-foreground">
									{result.path.join(" / ")}
								</p>
								{result.furniture && (
									<p className="break-words text-xs text-muted-foreground">
										{result.furniture.classname} · #{result.furniture.id} ·
										sprite {result.furniture.spriteId}
									</p>
								)}
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
