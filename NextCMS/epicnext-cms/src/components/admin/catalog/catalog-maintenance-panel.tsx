"use client";

import { AlertTriangle, CheckCircle2, RefreshCw, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	applyAlignIdsAction,
	fixCatalogOffersAction,
	fixEmulatorIssuesAction,
	fixEverythingAction,
	fixSpriteIdsAction,
	getFurniHealthAction,
	previewAlignIdsAction,
	reconcileIdsAction,
	removeDuplicateItemsBaseAction,
} from "@/actions/furni-maintenance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

interface Health {
	itemsBaseTotal: number;
	spriteIdMismatch: number;
	catalogOfferMismatch: number;
	duplicateClassnames: number;
	idMismatchVsFurnidata: number;
	catalogDuplicates: number;
	catalogBcDuplicates: number;
	catalogPageDuplicates: number;
	emulatorIssues: number;
}

export function CatalogMaintenancePanel() {
	const [health, setHealth] = useState<Health | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);
	const [dedupePages, setDedupePages] = useState(true);
	const [alignPreview, setAlignPreview] = useState<{
		moves: number;
		inserted: number;
		skipped: string[];
	} | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		const res = await getFurniHealthAction();
		if (res.ok && res.data?.health) setHealth(res.data.health as Health);
		else if (!res.ok) toast.error(res.error);
		setAlignPreview(null);
		setLoading(false);
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	async function run(
		key: string,
		fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>,
		success: string,
	) {
		setBusy(key);
		try {
			const res = await fn();
			if (res.ok) {
				toast.success(success);
				await refresh();
			} else {
				toast.error(res.error ?? "Failed");
			}
		} catch (e) {
			toast.error(String(e));
		} finally {
			setBusy(null);
		}
	}

	function Stat({
		label,
		value,
		hint,
	}: {
		label: string;
		value: number;
		hint?: string;
	}) {
		const ok = value === 0;
		return (
			<div className="flex items-center justify-between rounded-md border p-3">
				<div>
					<div className="text-sm text-muted-foreground">{label}</div>
					<div className="text-xs text-muted-foreground">{hint}</div>
				</div>
				<Badge variant={ok ? "default" : "destructive"}>
					{ok ? <CheckCircle2 className="mr-1 h-3 w-3" /> : value}
				</Badge>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-4xl space-y-6 p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-semibold">
						<Wrench className="h-5 w-5" /> Catalog maintenance
					</h1>
					<p className="text-sm text-muted-foreground">
						Force the furniture tables to 100% consistency with
						FurnitureData.json. Every action runs inside a database transaction
						and rolls back on error.
					</p>
				</div>
				<Button
					variant="outline"
					onClick={() => void refresh()}
					disabled={loading}
				>
					<RefreshCw
						className={loading ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"}
					/>
					Refresh
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Current health</CardTitle>
					<CardDescription>
						{health
							? `${health.itemsBaseTotal} items in items_base`
							: "Loading…"}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{health && (
						<>
							<Stat
								label="sprite_id ≠ id"
								value={health.spriteIdMismatch}
								hint="items_base sprite drift"
							/>
							<Stat
								label="offer_id ≠ id"
								value={health.catalogOfferMismatch}
								hint="catalog offer drift"
							/>
							<Stat
								label="Duplicate classnames"
								value={health.duplicateClassnames}
								hint="items_base item_name repeats"
							/>
							<Stat
								label="Duplicate catalog rows"
								value={health.catalogDuplicates}
								hint="same product listed twice on a page"
							/>
							<Stat
								label="ID ≠ FurnitureData"
								value={health.idMismatchVsFurnidata}
								hint="items_base id differs from furnidata"
							/>
							<Stat
								label="Duplicate BC catalog rows"
								value={health.catalogBcDuplicates}
								hint="same product listed twice in builder club"
							/>
							<Stat
								label="Duplicate catalog pages"
								value={health.catalogPageDuplicates}
								hint="same caption under the same parent (double links)"
							/>
							<Stat
								label="Emulator catalog issues"
								value={health.emulatorIssues}
								hint="points currency, prices, stack, orphans, order numbers"
							/>
						</>
					)}
				</CardContent>
			</Card>

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Button
					disabled={busy !== null}
					onClick={() =>
						void run("sprite", fixSpriteIdsAction, "sprite_id fixed")
					}
				>
					Fix sprite_id
				</Button>
				<Button
					disabled={busy !== null}
					onClick={() =>
						void run("offer", fixCatalogOffersAction, "catalog offer_id fixed")
					}
				>
					Fix catalog offer_id
				</Button>
				<Button
					disabled={busy !== null}
					onClick={() =>
						void run(
							"dup",
							removeDuplicateItemsBaseAction,
							"Duplicates removed (items + catalog)",
						)
					}
				>
					Remove duplicates (items + catalog)
				</Button>
				<Button
					disabled={busy !== null}
					onClick={() =>
						void run(
							"reconcile",
							reconcileIdsAction,
							"FurnitureData reconciled",
						)
					}
				>
					Reconcile FurnitureData ↔ DB
				</Button>
				<Button
					variant="secondary"
					disabled={busy !== null}
					onClick={() =>
						void run(
							"emulator",
							fixEmulatorIssuesAction,
							"Emulator catalog constraints fixed",
						)
					}
				>
					Fix emulator constraints
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Align items_base IDs to FurnitureData</CardTitle>
					<CardDescription>
						Moves every items_base.id to the FurnitureData sprite id (source of
						truth). Rewrites all referencing tables. Preview first.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<Button
						variant="outline"
						disabled={busy !== null}
						onClick={async () => {
							setBusy("preview");
							const res = await previewAlignIdsAction();
							setBusy(null);
							if (res.ok && res.data) {
								setAlignPreview(res.data as typeof alignPreview);
								toast.success("Preview ready");
							} else if (!res.ok) toast.error(res.error ?? "Preview failed");
						}}
					>
						Preview changes
					</Button>
					{alignPreview && (
						<div className="rounded-md border p-3 text-sm">
							<div>
								Planned ID moves: <b>{alignPreview.moves}</b>
							</div>
							<div>
								New items to insert: <b>{alignPreview.inserted}</b>
							</div>
							{alignPreview.skipped.length > 0 && (
								<div className="mt-1 text-muted-foreground">
									Skipped (id occupied): {alignPreview.skipped.join(", ")}
								</div>
							)}
						</div>
					)}
					<Button
						disabled={busy !== null || !alignPreview}
						onClick={() =>
							void run(
								"align",
								applyAlignIdsAction,
								"items_base IDs aligned to FurnitureData",
							)
						}
					>
						Apply alignment
					</Button>
				</CardContent>
			</Card>

			<Card className="border-destructive/50">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-destructive">
						<AlertTriangle className="h-4 w-4" /> Fix everything
					</CardTitle>
					<CardDescription>
						Runs sprite fix, offer fix, reconcile, dedup and ID alignment in
						order. Heavy operation — make a backup first.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="mb-3 flex items-center gap-2 rounded-md border p-2">
						<Checkbox
							id="dedupe-pages"
							checked={dedupePages}
							onCheckedChange={(v) => setDedupePages(v === true)}
						/>
						<label
							htmlFor="dedupe-pages"
							className="text-sm text-muted-foreground"
						>
							Also merge duplicate catalog pages (double links)
						</label>
					</div>
					<Button
						variant="destructive"
						disabled={busy !== null}
						onClick={async () => {
							setBusy("all");
							try {
								const res = await fixEverythingAction({ dedupePages });
								if (res.ok) {
									toast.success("All repairs applied");
									await refresh();
								} else {
									toast.error(res.error ?? "Failed");
								}
							} catch (e) {
								toast.error(String(e));
							} finally {
								setBusy(null);
							}
						}}
					>
						Fix everything now
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
