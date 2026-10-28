"use client";

import {
	Check,
	Download,
	Loader2,
	Package,
	PawPrint,
	Search,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	BatchImportProgress,
	useBatchImport,
} from "@/components/admin/import/use-batch-import";
import { ImportErrorBanner } from "@/components/admin/import-error-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminFetch } from "@/lib/admin-fetch";
import { cn } from "@/lib/utils";

interface PetItem {
	lib: string;
	nitroExists: boolean;
}

/** Real pet preview cropped from its .nitro; falls back to the paw glyph. */
function PetIcon({ lib }: { lib: string }) {
	const [failed, setFailed] = useState(false);
	if (failed) return <PawPrint className="w-8 h-8 text-muted-foreground/60" />;
	return (
		<img
			src={`/cms_api/admin/import/pets/icon?lib=${encodeURIComponent(lib)}&v=6`}
			alt={lib}
			className="image-pixelated"
			style={{ maxHeight: 56, maxWidth: 56 }}
			onError={() => setFailed(true)}
		/>
	);
}

export function ImportPetsClient() {
	const [searchTerm, setSearchTerm] = useState("");
	const [pets, setPets] = useState<PetItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [busyLib, setBusyLib] = useState<string | null>(null);
	const batch = useBatchImport({
		url: "/cms_api/admin/import/pets/batch",
		successAction: "pet(s) imported",
		cancelledMessage: "Import cancelled",
		onItemDone: (lib) => markDone(lib),
		onComplete: () => setSelected(new Set()),
	});

	const fetchPets = useCallback(async (search: string) => {
		setLoading(true);
		setError("");
		try {
			const params = new URLSearchParams();
			if (search) params.set("search", search);
			const res = await adminFetch(`/cms_api/admin/import/pets?${params}`);
			const data = await res.json();
			if (!res.ok) {
				setError(data.error || "Failed to load");
				return;
			}
			setPets(data.pets || []);
			setSelected(new Set());
		} catch {
			setError("Network error");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchPets("");
	}, [fetchPets]);

	const importable = useMemo(() => pets.filter((p) => !p.nitroExists), [pets]);
	const importedCount = useMemo(
		() => pets.filter((p) => p.nitroExists).length,
		[pets],
	);

	function toggle(lib: string) {
		setSelected((prev) => {
			const n = new Set(prev);
			if (n.has(lib)) n.delete(lib);
			else n.add(lib);
			return n;
		});
	}

	function markDone(lib: string) {
		setPets((prev) =>
			prev.map((p) => (p.lib === lib ? { ...p, nitroExists: true } : p)),
		);
	}

	async function importViaSse(items: PetItem[]) {
		await batch.run(
			items.map((p) => p.lib),
			{ items, concurrency: 3 },
		);
	}

	async function importOne(p: PetItem) {
		setBusyLib(p.lib);
		try {
			await importViaSse([p]);
		} finally {
			setBusyLib(null);
		}
	}

	async function importSelected() {
		const items = pets.filter((p) => selected.has(p.lib) && !p.nitroExists);
		if (items.length === 0) return;
		await importViaSse(items);
	}

	async function remove(p: PetItem) {
		setBusyLib(p.lib);
		try {
			const res = await adminFetch(
				`/cms_api/admin/import/pets?lib=${encodeURIComponent(p.lib)}`,
				{
					method: "DELETE",
				},
			);
			const data = await res.json();
			if (res.ok) {
				toast.success(`${p.lib} removed`);
				setPets((prev) =>
					prev.map((x) => (x.lib === p.lib ? { ...x, nitroExists: false } : x)),
				);
			} else {
				toast.error(data.error || "Delete failed");
			}
		} finally {
			setBusyLib(null);
		}
	}

	return (
		<div className="space-y-4">
			{pets.length > 0 && (
				<div className="flex items-center gap-3 flex-wrap">
					<div className="flex items-center gap-1.5 text-sm">
						<Package className="h-4 w-4 text-muted-foreground" />
						<span className="font-medium">{pets.length}</span>
						<span className="text-muted-foreground">pets</span>
					</div>
					<div className="flex items-center gap-1.5 text-sm">
						<Check className="h-4 w-4 text-[var(--admin-success)]" />
						<span className="font-medium text-[var(--admin-success)]">
							{importedCount}
						</span>
						<span className="text-muted-foreground">imported</span>
					</div>
					<div className="flex items-center gap-1.5 text-sm">
						<Download className="h-4 w-4 text-muted-foreground" />
						<span className="font-medium">{importable.length}</span>
						<span className="text-muted-foreground">missing</span>
					</div>
				</div>
			)}

			<div className="flex gap-2 flex-wrap">
				<div className="relative flex-1 max-w-md">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<Input
						placeholder="Search pets..."
						value={searchTerm}
						onChange={(e) => setSearchTerm(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") fetchPets(searchTerm);
							if (e.key === "Escape") {
								setSearchTerm("");
								fetchPets("");
							}
						}}
						className="pl-9 pr-8"
					/>
					{searchTerm && (
						<button
							type="button"
							onClick={() => {
								setSearchTerm("");
								fetchPets("");
							}}
							className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
				<Button
					onClick={() => fetchPets(searchTerm)}
					size="sm"
					disabled={loading}
				>
					{loading ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<Search className="w-4 h-4" />
					)}
				</Button>
			</div>

			{importable.length > 0 && (
				<div className="flex items-center gap-2 flex-wrap">
					<Button
						variant="outline"
						size="sm"
						className="text-xs h-8"
						disabled={batch.running}
						onClick={() =>
							setSelected((prev) =>
								prev.size === importable.length
									? new Set()
									: new Set(importable.map((p) => p.lib)),
							)
						}
					>
						{selected.size === importable.length
							? "Deselect All"
							: `Select All (${importable.length})`}
					</Button>
					{selected.size > 0 && (
						<Button
							size="sm"
							className="h-8"
							onClick={importSelected}
							disabled={batch.running}
						>
							{batch.running ? (
								<Loader2 className="w-4 h-4 animate-spin mr-1" />
							) : (
								<Download className="w-4 h-4 mr-1" />
							)}
							Import {selected.size} selected
						</Button>
					)}
					{batch.progress && (
						<BatchImportProgress
							progress={batch.progress}
							onCancel={batch.cancel}
						/>
					)}
				</div>
			)}

			{error && <ImportErrorBanner error={error} />}

			{!loading && pets.length === 0 && !error && (
				<div className="text-center py-12 text-muted-foreground">
					<PawPrint className="w-12 h-12 mx-auto mb-3 opacity-50" />
					<p className="text-sm">No pets found</p>
				</div>
			)}

			{pets.length > 0 && (
				<div
					className={cn(
						"grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3",
						loading && "opacity-50",
					)}
				>
					{pets.map((p) => {
						const isSelected = selected.has(p.lib);
						return (
							<div
								key={p.lib}
								className={cn(
									"rounded-lg border overflow-hidden bg-card relative hover:border-border transition-all",
									p.nitroExists && "ring-1 ring-[var(--admin-success)]/30",
									isSelected && "ring-2 ring-primary border-primary",
								)}
							>
								{!p.nitroExists && (
									<button
										type="button"
										onClick={() => toggle(p.lib)}
										className={cn(
											"absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
											isSelected
												? "bg-primary border-primary text-primary-foreground"
												: "bg-background/80 border-muted-foreground/30 hover:border-muted-foreground",
										)}
									>
										{isSelected && <Check className="w-3 h-3" />}
									</button>
								)}
								<div className="flex items-center justify-center h-20 bg-accent/20">
									<PetIcon lib={p.lib} />
								</div>
								<div className="px-2.5 py-2 border-t space-y-1">
									<div className="text-xs font-bold truncate">{p.lib}</div>
									<div className="pt-1">
										{p.nitroExists ? (
											<div className="flex items-center gap-1">
												<Badge className="text-[10px] px-1.5 py-0 bg-[var(--admin-success-subtle)] text-[var(--admin-success)] border-0 gap-0.5 flex-1 justify-center">
													<Check className="w-2.5 h-2.5" />
													Imported
												</Badge>
												<Button
													variant="ghost"
													size="sm"
													className="h-5 w-5 p-0 shrink-0"
													title="Remove pet"
													disabled={busyLib === p.lib || batch.running}
													onClick={() => remove(p)}
												>
													<Trash2 className="w-3 h-3" />
												</Button>
											</div>
										) : (
											<Button
												size="sm"
												variant="outline"
												className="w-full text-xs h-7"
												disabled={busyLib === p.lib || batch.running}
												onClick={() => importOne(p)}
											>
												{busyLib === p.lib ? (
													<Loader2 className="w-3 h-3 animate-spin mr-1" />
												) : (
													<Download className="w-3 h-3 mr-1" />
												)}
												Import
											</Button>
										)}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
