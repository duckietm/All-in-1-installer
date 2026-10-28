"use client";

import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminSearchResult } from "@/app/api/admin/search/route";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { useDebounce } from "@/hooks/use-debounce";
import { confirmUnsavedNavigation } from "@/hooks/use-unsaved-changes";
import {
	type AdminNavigationOptions,
	visibleAdminNavigation,
} from "@/lib/admin-navigation";
import { AdminSearchRequest } from "@/lib/admin-search-request";

type SearchResult = AdminSearchResult;

type SearchResponse = {
	ok: boolean;
	results: SearchResult[];
	partial?: boolean;
};

export function SearchDialog({
	navigation,
}: {
	navigation: AdminNavigationOptions;
}) {
	const tNav = useTranslations("pages.admin.nav");
	const getPages = (queryPlaceholder: string) =>
		visibleAdminNavigation(navigation)
			.flatMap((group) =>
				group.items.map((item) => ({ ...item, group: tNav(group.labelKey) })),
			)
			.filter((item) =>
				[tNav(item.labelKey), item.group, item.href]
					.join(" ")
					.toLocaleLowerCase()
					.includes(queryPlaceholder),
			);
	const t = useTranslations("pages.admin.search");
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SearchResult[]>([]);
	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(false);
	const [partial, setPartial] = useState(false);
	const debouncedQuery = useDebounce(query, 250);
	const requestRef = useRef(new AdminSearchRequest());

	const groupLabels: Record<string, string> = {
		users: t("users"),
		articles: t("articles"),
		rooms: t("rooms"),
		guilds: t("guilds"),
		shop: t("shop"),
		rareValues: t("rareValues"),
		furniture: t("furniture"),
		catalog: t("catalog"),
		tickets: t("tickets"),
	};

	const fetchResults = useCallback(async (q: string) => {
		requestRef.current.cancel();
		setFailed(false);
		setPartial(false);
		setResults([]);
		if (!canSearchRecords(q)) {
			setResults([]);
			setLoading(false);
			return;
		}
		const controller = requestRef.current.start();
		setLoading(true);
		try {
			const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`, {
				signal: controller.signal,
			});
			if (!res.ok) throw new Error("Search request failed");
			const data: SearchResponse = await res.json();
			if (!requestRef.current.accepts(controller)) return;
			if (data.ok) {
				setResults(data.results);
				setPartial(Boolean(data.partial));
			} else setFailed(true);
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") return;
			if (requestRef.current.accepts(controller)) {
				setResults([]);
				setFailed(true);
			}
		} finally {
			if (requestRef.current.accepts(controller)) setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!open || query !== debouncedQuery) return;
		fetchResults(debouncedQuery);
		return () => requestRef.current.cancel();
	}, [debouncedQuery, fetchResults, open, query]);

	useEffect(() => {
		return () => requestRef.current.cancel();
	}, []);

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault();
				setOpen((prev) => !prev);
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, []);

	function handleQueryChange(value: string) {
		requestRef.current.cancel();
		setQuery(value.slice(0, 64));
		setResults([]);
		setFailed(false);
		setPartial(false);
		setLoading(canSearchRecords(value));
	}

	function handleOpenChange(next: boolean) {
		if (!next) {
			requestRef.current.cancel();
			setQuery("");
			setResults([]);
			setFailed(false);
			setPartial(false);
			setLoading(false);
		}
		setOpen(next);
	}

	function handleSelect(url: string) {
		if (!confirmUnsavedNavigation()) return;
		handleOpenChange(false);
		setQuery("");
		setResults([]);
		router.push(url);
	}

	const grouped = groupResults(query === debouncedQuery ? results : []);
	const pages = getPages(query.trim().toLocaleLowerCase()).slice(0, 8);

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger
				type="button"
				aria-label={t("placeholder")}
				className="flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-1.5 text-xs text-[var(--admin-text-muted)] hover:border-[var(--admin-accent)]/40 hover:text-[var(--admin-text)] transition-colors cursor-pointer"
			>
				<SearchIcon size={14} />
				<span className="hidden sm:inline">{t("placeholder")}</span>
				<kbd className="pointer-events-none hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-60">
					Ctrl/⌘ K
				</kbd>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
				<DialogTitle className="sr-only">{t("placeholder")}</DialogTitle>
				<DialogDescription className="sr-only">
					{t("description")}
				</DialogDescription>
				<Command
					className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
					shouldFilter={false}
				>
					<CommandInput
						placeholder={t("placeholder")}
						value={query}
						onValueChange={handleQueryChange}
						aria-label={t("placeholder")}
						maxLength={64}
						className="h-12"
					/>
					<CommandList className="max-h-[400px]">
						{loading && canSearchRecords(query) ? (
							<div className="py-6 text-center text-sm text-muted-foreground">
								…
							</div>
						) : null}
						{!loading && !failed && !partial && canSearchRecords(query) && (
							<CommandEmpty>{t("noResults")}</CommandEmpty>
						)}
						{!canSearchRecords(query) && (
							<p className="p-4 text-sm text-muted-foreground">{t("hint")}</p>
						)}
						{(failed || partial) && (
							<p role="alert" className="p-4 text-sm">
								{t(partial ? "partialError" : "loadError")}
								<button
									type="button"
									onClick={() => fetchResults(query)}
									className="ml-2 underline"
								>
									{t("retry")}
								</button>
							</p>
						)}
						{pages.length > 0 && (
							<CommandGroup heading={t("pages")}>
								{pages.map((item) => (
									<CommandItem
										key={item.href}
										value={item.href}
										onSelect={() => handleSelect(item.href)}
									>
										<item.icon size={16} />
										<span>{tNav(item.labelKey)}</span>
										<span className="ml-auto text-xs text-muted-foreground">
											{item.group}
										</span>
									</CommandItem>
								))}
							</CommandGroup>
						)}
						{Object.entries(grouped).map(([group, items]) => (
							<CommandGroup key={group} heading={groupLabels[group] ?? group}>
								{items.map((item) => (
									<CommandItem
										key={`${item.type}-${item.id}`}
										value={`${item.type}-${item.id}`}
										onSelect={() => handleSelect(item.url)}
										className="flex flex-col items-start gap-0.5 py-2"
									>
										<span className="w-full min-w-0 truncate text-sm font-medium">
											{item.title}
										</span>
										{item.subtitle ? (
											<span className="text-xs text-muted-foreground truncate w-full">
												{item.subtitle}
											</span>
										) : null}
									</CommandItem>
								))}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}

function canSearchRecords(value: string) {
	const q = value.trim();
	return q.length >= 2 || /^[1-9]$/.test(q);
}

function groupResults(results: SearchResult[]) {
	const grouped: Record<string, SearchResult[]> = {};
	for (const r of results) {
		if (!grouped[r.type]) grouped[r.type] = [];
		grouped[r.type].push(r);
	}
	return grouped;
}
