"use client";

import { Download, Info, Lock, Save } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { saveClientTranslations } from "@/actions/translations";
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
import type { ClientTranslationFile } from "@/lib/client-translation-files";

interface Props {
	files: ClientTranslationFile[];
	activeFile: ClientTranslationFile;
	entries: Record<string, string>;
	parseError: string | null;
}

export function ClientTranslations({
	files,
	activeFile,
	entries,
	parseError,
}: Props) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [data, setData] = useState<Record<string, string>>(entries);
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(1);
	const { run, isPending } = useServerAction();
	const PER_PAGE = 50;

	// Re-sync local state when the user switches file (server re-renders with
	// fresh entries; useState only initializes once).
	useEffect(() => {
		setData(entries);
		setSearch("");
		setPage(1);
	}, [entries]);

	const filteredKeys = useMemo(() => {
		const keys = Object.keys(data);
		if (!search) return keys;
		const q = search.toLowerCase();
		return keys.filter(
			(k) => k.toLowerCase().includes(q) || data[k].toLowerCase().includes(q),
		);
	}, [data, search]);

	const totalPages = Math.max(1, Math.ceil(filteredKeys.length / PER_PAGE));
	const pageKeys = filteredKeys.slice((page - 1) * PER_PAGE, page * PER_PAGE);

	function changeFile(id: string) {
		const params = new URLSearchParams(searchParams?.toString());
		params.set("file", id);
		router.push(`${pathname}?${params.toString()}`);
	}

	function updateValue(key: string, value: string) {
		setData((d) => ({ ...d, [key]: value }));
	}

	function handleSave() {
		if (activeFile.readOnly) return;
		run(() => saveClientTranslations({ fileId: activeFile.id, data }), {
			successMessage: "File saved.",
			onSuccess: (result) => {
				if (result?.commentsLost) {
					toast.warning(
						"Some keys did not match the standard format: file was reserialized and comments were removed.",
					);
				}
				router.refresh();
			},
		});
	}

	function handleExport() {
		const blob = new Blob([JSON.stringify(data, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = activeFile.relPath.split("/").pop() ?? "translations.json";
		a.click();
		URL.revokeObjectURL(url);
	}

	return (
		<div className="space-y-4">
			<div className="flex justify-end flex-wrap gap-2">
				<div className="flex gap-2">
					<Button variant="outline" size="sm" onClick={handleExport}>
						<Download className="w-4 h-4 mr-1" /> Export
					</Button>
					<Button
						size="sm"
						onClick={handleSave}
						disabled={isPending || activeFile.readOnly || !!parseError}
					>
						<Save className="w-4 h-4 mr-1" /> {isPending ? "Saving..." : "Save"}
					</Button>
				</div>
			</div>

			<div className="flex gap-3 items-center flex-wrap">
				<Select value={activeFile.id} onValueChange={changeFile}>
					<SelectTrigger className="w-[360px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{files.map((f) => (
							<SelectItem key={f.id} value={f.id}>
								<div className="flex items-center gap-2">
									<span className="font-mono text-xs">
										{f.relPath.replace("public/", "")}
									</span>
									{f.readOnly && (
										<span className="text-[10px] uppercase text-muted-foreground">
											RO
										</span>
									)}
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Input
					placeholder="Search by key or value..."
					value={search}
					onChange={(e) => {
						setSearch(e.target.value);
						setPage(1);
					}}
					className="max-w-xs"
				/>

				<span className="text-sm text-muted-foreground">
					{filteredKeys.length} keys
				</span>
			</div>

			<div className="flex gap-2 flex-wrap">
				<Badge variant="outline" className="font-mono text-[11px]">
					{activeFile.format.toUpperCase()}
				</Badge>
				<Badge variant="outline" className="text-[11px]">
					{activeFile.language === "shared"
						? "shared"
						: activeFile.language.toUpperCase()}
				</Badge>
				{activeFile.readOnly && (
					<Badge variant="secondary" className="gap-1 text-[11px]">
						<Lock className="w-3 h-3" /> read-only
					</Badge>
				)}
				{activeFile.hasComments && !activeFile.readOnly && (
					<Badge variant="secondary" className="gap-1 text-[11px]">
						<Info className="w-3 h-3" /> comments preserved
					</Badge>
				)}
			</div>

			{activeFile.note && (
				<div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
					{activeFile.note}
				</div>
			)}

			{activeFile.readOnly && (
				<div className="rounded-md border border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)] px-3 py-2 text-xs text-[var(--admin-warning)] dark:text-[var(--admin-warning)] flex items-start gap-2">
					<Lock className="w-4 h-4 flex-shrink-0 mt-0.5" />
					<div>
						This file is read-only.{" "}
						{activeFile.note ?? "Manual editing is not supported by the CMS."}
					</div>
				</div>
			)}

			{activeFile.hasComments && !activeFile.readOnly && (
				<div className="rounded-md border border-[var(--admin-info-border)] bg-[var(--admin-info-subtle)] px-3 py-2 text-xs text-[var(--admin-info)] dark:text-[var(--admin-info)] flex items-start gap-2">
					<Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
					<div>
						Comments are preserved: saving only patches changed value lines. If
						a key uses a non-standard format and cannot be patched in-place, the
						file is reserialized (comments lost) and you will be warned.
					</div>
				</div>
			)}

			{parseError && (
				<div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
					Parse error: {parseError}
				</div>
			)}

			<div className="rounded-lg border bg-card divide-y">
				{pageKeys.length === 0 && !parseError && (
					<div className="px-4 py-6 text-sm text-muted-foreground text-center">
						No entries.
					</div>
				)}
				{pageKeys.map((key) => (
					<div key={key} className="flex items-center gap-3 px-4 py-2">
						<span
							className="text-xs font-mono text-muted-foreground w-72 truncate flex-shrink-0"
							title={key}
						>
							{key}
						</span>
						<Input
							value={data[key]}
							onChange={(e) => updateValue(key, e.target.value)}
							className="flex-1 h-8 text-sm"
							disabled={activeFile.readOnly}
						/>
					</div>
				))}
			</div>

			{totalPages > 1 && (
				<div className="flex items-center justify-between">
					<span className="text-sm text-muted-foreground">
						Page {page} of {totalPages}
					</span>
					<div className="flex gap-1">
						<Button
							variant="outline"
							size="sm"
							disabled={page <= 1}
							onClick={() => setPage(page - 1)}
						>
							Prev
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={page >= totalPages}
							onClick={() => setPage(page + 1)}
						>
							Next
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
