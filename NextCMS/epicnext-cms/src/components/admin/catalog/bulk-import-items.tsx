"use client";

import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { bulkCreateCatalogItems } from "@/actions/catalog-items";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ParsedRow {
	lineNumber: number;
	raw: string;
	ok: boolean;
	error?: string;
	baseId?: number;
	credits?: number;
	points?: number;
	pointsType?: number;
}

interface BulkImportItemsProps {
	pageId: number;
	onImported?: () => void;
}

export function BulkImportItems({ pageId, onImported }: BulkImportItemsProps) {
	const [open, setOpen] = useState(false);
	const [input, setInput] = useState("");
	const [importing, setImporting] = useState(false);

	const parsed = useMemo<ParsedRow[]>(() => {
		const lines = input.split("\n");
		const out: ParsedRow[] = [];
		lines.forEach((raw, idx) => {
			const trimmed = raw.trim();
			if (!trimmed || trimmed.startsWith("#")) return;
			const parts = trimmed.split(/[,\s;]+/).filter(Boolean);
			const baseId = parseInt(parts[0], 10);
			if (Number.isNaN(baseId) || baseId <= 0) {
				out.push({
					lineNumber: idx + 1,
					raw: trimmed,
					ok: false,
					error: "Invalid base ID",
				});
				return;
			}
			const credits = parts[1] !== undefined ? parseInt(parts[1], 10) : 0;
			const points = parts[2] !== undefined ? parseInt(parts[2], 10) : 0;
			const pointsType = parts[3] !== undefined ? parseInt(parts[3], 10) : 0;
			if (
				(parts[1] !== undefined && Number.isNaN(credits)) ||
				(parts[2] !== undefined && Number.isNaN(points))
			) {
				out.push({
					lineNumber: idx + 1,
					raw: trimmed,
					ok: false,
					error: "Invalid number",
				});
				return;
			}
			out.push({
				lineNumber: idx + 1,
				raw: trimmed,
				ok: true,
				baseId,
				credits,
				points,
				pointsType,
			});
		});
		return out;
	}, [input]);

	const validCount = parsed.filter((r) => r.ok).length;
	const invalidCount = parsed.length - validCount;

	async function handleImport() {
		const valid = parsed.filter(
			(r): r is ParsedRow & { baseId: number } => r.ok && r.baseId != null,
		);
		if (valid.length === 0) {
			toast.error("No valid rows to import");
			return;
		}
		setImporting(true);
		try {
			const res = await bulkCreateCatalogItems({
				pageId,
				rows: valid.map((row) => ({
					baseId: row.baseId,
					credits: row.credits,
					points: row.points,
					pointsType: row.pointsType,
				})),
			});
			if (!res.ok) {
				toast.error(res.error || "Bulk import failed.");
				return;
			}
			const { created, failed } = res.data;
			if (created > 0) {
				toast.success(
					`Imported ${created} item(s)${failed > 0 ? `, ${failed} failed` : ""}.`,
				);
				setInput("");
				setOpen(false);
				onImported?.();
			} else {
				toast.error(
					failed > 0
						? `All ${failed} imports failed (unknown base IDs?).`
						: "Nothing imported.",
				);
			}
		} catch {
			toast.error("Bulk import failed.");
		} finally {
			setImporting(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Button variant="outline" size="sm" onClick={() => setOpen(true)}>
				<Upload className="mr-2 h-4 w-4" />
				Bulk Import
			</Button>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Bulk Import Items</DialogTitle>
				</DialogHeader>

				<div className="space-y-3">
					<div className="space-y-2">
						<Label>Item list</Label>
						<Textarea
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder={`One per line: base_id[, credits[, points[, points_type]]]\n# Lines starting with # are ignored\n12345, 50\n12346, 0, 10, 5\n12347`}
							rows={10}
							className="font-mono text-xs"
						/>
						<p className="text-[11px] text-muted-foreground">
							Format:{" "}
							<code className="rounded bg-muted px-1">
								base_id, credits, points, points_type
							</code>
							. Only <code>base_id</code> is required; other fields default to
							0. Separators: comma, space, or semicolon.
						</p>
					</div>

					{parsed.length > 0 && (
						<div className="space-y-2">
							<div className="flex items-center gap-3 text-xs">
								<Badge variant="default" className="gap-1">
									<CheckCircle2 className="h-3 w-3" />
									{validCount} valid
								</Badge>
								{invalidCount > 0 && (
									<Badge variant="destructive" className="gap-1">
										<AlertTriangle className="h-3 w-3" />
										{invalidCount} invalid
									</Badge>
								)}
							</div>
							<div className="max-h-[200px] overflow-y-auto rounded border">
								<table className="w-full text-xs">
									<thead className="sticky top-0 bg-muted/50">
										<tr>
											<th className="px-2 py-1 text-left">Line</th>
											<th className="px-2 py-1 text-left">Base ID</th>
											<th className="px-2 py-1 text-left">Credits</th>
											<th className="px-2 py-1 text-left">Points</th>
											<th className="px-2 py-1 text-left">Type</th>
											<th className="px-2 py-1 text-left">Status</th>
										</tr>
									</thead>
									<tbody>
										{parsed.map((row) => (
											<tr
												key={row.lineNumber}
												className={row.ok ? "" : "bg-destructive/10"}
											>
												<td className="px-2 py-0.5 font-mono text-muted-foreground">
													{row.lineNumber}
												</td>
												<td className="px-2 py-0.5 font-mono">
													{row.baseId ?? "—"}
												</td>
												<td className="px-2 py-0.5 font-mono">
													{row.credits ?? "—"}
												</td>
												<td className="px-2 py-0.5 font-mono">
													{row.points ?? "—"}
												</td>
												<td className="px-2 py-0.5 font-mono">
													{row.pointsType ?? "—"}
												</td>
												<td className="px-2 py-0.5">
													{row.ok ? (
														<span className="text-[var(--admin-success)]">
															OK
														</span>
													) : (
														<span className="text-destructive">
															{row.error}
														</span>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}

					<div className="flex justify-end gap-2">
						<Button
							variant="outline"
							onClick={() => setOpen(false)}
							disabled={importing}
						>
							Cancel
						</Button>
						<Button
							onClick={handleImport}
							disabled={importing || validCount === 0}
						>
							{importing ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Upload className="mr-2 h-4 w-4" />
							)}
							Import {validCount} item{validCount !== 1 ? "s" : ""}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
