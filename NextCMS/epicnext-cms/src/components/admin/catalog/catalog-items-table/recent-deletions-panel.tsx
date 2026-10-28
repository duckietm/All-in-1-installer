"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { listRestorableCatalogItemDeletions } from "@/actions/catalog-items";
import { Button } from "@/components/ui/button";

interface RestorableDeletion {
	restoreId: number;
	offers: number;
	deletedAt: string;
}

/**
 * The undo toast only lives a few seconds. A delete noticed after that window is
 * still recoverable — the rows are kept until they are restored — so the offer
 * has to be reachable here too. Without this panel the only way back into a
 * past deletion is editing the database by hand.
 */
export function RecentDeletionsPanel({
	onRestored,
}: {
	onRestored: () => void;
}) {
	const [entries, setEntries] = useState<RestorableDeletion[]>([]);
	const [loading, setLoading] = useState(true);
	const [restoring, setRestoring] = useState<number | null>(null);
	const [failed, setFailed] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		setFailed(false);
		try {
			const result = await listRestorableCatalogItemDeletions();
			if (result.ok) setEntries(result.data);
			else setFailed(true);
		} catch {
			setFailed(true);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function restore(entry: RestorableDeletion) {
		if (restoring !== null) return;
		setRestoring(entry.restoreId);
		try {
			const { restoreDeletedCatalogItems } = await import(
				"@/actions/catalog-items"
			);
			const result = await restoreDeletedCatalogItems({
				restoreId: entry.restoreId,
				requestKey: crypto.randomUUID(),
			});
			if (!result.ok) {
				toast.error(result.error ?? "Could not restore those offers.");
				// The reason is usually that an id got reused, which is permanent:
				// re-listing so the entry stops offering a restore that cannot work.
				await load();
				return;
			}
			toast.success(`Restored ${result.data.restored} offer(s).`);
			onRestored();
			await load();
		} catch {
			toast.error("Could not restore those offers.");
		} finally {
			setRestoring(null);
		}
	}

	if (loading) {
		return (
			<p className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 aria-hidden className="h-4 w-4 animate-spin" />
				Loading recent deletions…
			</p>
		);
	}

	if (failed) {
		return (
			<div className="flex items-center gap-2 text-sm">
				<span className="text-[var(--admin-error)]">
					Could not load recent deletions.
				</span>
				<Button variant="ghost" size="sm" onClick={() => void load()}>
					Retry
				</Button>
			</div>
		);
	}

	if (!entries.length) return null;

	return (
		<div className="rounded-md border border-[var(--admin-border)] p-2">
			<p className="mb-1.5 text-xs font-medium text-[var(--admin-text-muted)]">
				Recent deletions — restorable
			</p>
			<ul className="space-y-1">
				{entries.map((entry) => (
					<li
						key={entry.restoreId}
						className="flex items-center justify-between gap-3 text-sm"
					>
						<span className="min-w-0 truncate">
							{entry.offers} offer(s) ·{" "}
							<time dateTime={entry.deletedAt}>
								{new Date(entry.deletedAt).toLocaleString()}
							</time>
						</span>
						<Button
							variant="outline"
							size="sm"
							disabled={restoring !== null}
							onClick={() => void restore(entry)}
						>
							{restoring === entry.restoreId && (
								<RotateCcw aria-hidden className="mr-2 h-4 w-4 animate-spin" />
							)}
							Restore
						</Button>
					</li>
				))}
			</ul>
		</div>
	);
}
