"use client";

import {
	AlertCircle,
	Check,
	CheckCircle2,
	ClipboardList,
	ExternalLink,
	Loader2,
	SearchX,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-fetch";

interface AuditIssue {
	type: string;
	severity: "error" | "warning" | "info";
	classname?: string;
	itemId?: number;
	catalogId?: number;
	message: string;
	sourceName?: string;
}

interface MissingFromSource {
	sourceName: string;
	sourceId: string;
	classname: string;
	itemName: string;
}

interface UnrepairableItem {
	classname: string;
	itemId: number;
	missing: Array<"nitro" | "icon">;
}

interface AuditSummary {
	totalItemsBase: number;
	totalCatalogItems: number;
	missingCatalog: number;
	orphanedCatalog: number;
	missingNitro: number;
	missingIcon: number;
	duplicates: number;
	missingFromSourcesTotal: number;
	unrepairableCount: number;
	iconsRepaired: number;
	iconsStillMissing: number;
	nitrosRepaired: number;
	nitrosStillMissing: number;
	catalogSqlCount: number;
	catalogSqlApplied: number;
	furniDataAdded: number;
	furniDataDuplicatesRemoved: number;
	orphanedRemoved: number;
	orphanedCleaned: number;
	duplicatesMerged: number;
	duplicateRowsRemoved: number;
	remappedReferences: number;
}

interface RepairStats {
	succeeded: number;
	failed: number;
	skipped: number;
	stillMissing: number;
}

interface AuditEvent {
	type: string;
	message?: string;
	current?: number;
	total?: number;
	section?: string;
	issues?: AuditIssue[];
	missingFromSources?: MissingFromSource[];
	unrepairable?: UnrepairableItem[];
	summary?: AuditSummary;
	repair?: RepairStats;
	repairNitro?: RepairStats;
	sql?: string;
	sqlCount?: number;
	applied?: number;
	sqlFailed?: number;
	furniData?: {
		added: number;
		removedDuplicates: number;
		removedIdConflicts: number;
	};
	structure?: {
		orphanedRemoved: number;
		orphanedCleaned: number;
		duplicatesMerged: number;
		duplicateRowsRemoved: number;
		remappedReferences: number;
	};
}

const TYPE_LABELS: Record<string, string> = {
	missing_catalog: "No catalog entry",
	orphaned_catalog: "Orphaned catalog reference",
	missing_nitro: "Missing .nitro file",
	missing_icon: "Missing icon file",
	duplicate_classname: "Duplicate classname",
	source_fetch_failed: "Source fetch failed",
};

function AuditCheckbox({
	checked,
	disabled,
	onChange,
	children,
}: {
	checked: boolean;
	disabled?: boolean;
	onChange: (value: boolean) => void;
	children: React.ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: custom checkbox so the checked state shows a visible checkmark on every admin theme
		<button
			type="button"
			role="checkbox"
			aria-checked={checked}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={`flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none ${
				disabled ? "opacity-50 cursor-not-allowed" : ""
			}`}
		>
			<span
				aria-hidden
				className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border-2 transition-colors ${
					checked
						? "border-[var(--admin-accent)] bg-[var(--admin-accent)]"
						: "border-[var(--admin-border)] bg-transparent"
				}`}
			>
				{checked && <Check className="h-3 w-3 text-[var(--admin-surface)]" />}
			</span>
			<span className="pointer-events-none">{children}</span>
		</button>
	);
}

export function AuditClient() {
	const [loading, setLoading] = useState(false);
	const [progress, setProgress] = useState("");
	const [activeTab, setActiveTab] = useState<
		"issues" | "sources" | "unrepairable"
	>("issues");
	const [repairEnabled, setRepairEnabled] = useState(true);
	const [repairNitros, setRepairNitros] = useState(true);
	const [generateSql, setGenerateSql] = useState(false);
	const [applySql, setApplySql] = useState(false);
	const [repairFurniData, setRepairFurniData] = useState(false);
	const [repairStructure, setRepairStructure] = useState(false);
	const [checkFurniDataIds, setCheckFurniDataIds] = useState(false);

	const [issues, setIssues] = useState<AuditIssue[]>([]);
	const [missingFromSources, setMissingFromSources] = useState<
		MissingFromSource[]
	>([]);
	const [unrepairable, setUnrepairable] = useState<UnrepairableItem[]>([]);
	const [summary, setSummary] = useState<AuditSummary | null>(null);
	const [repairStats, setRepairStats] = useState<RepairStats | null>(null);
	const [nitroRepairStats, setNitroRepairStats] = useState<RepairStats | null>(
		null,
	);
	const [sqlText, setSqlText] = useState<string | null>(null);
	const [sqlApplied, setSqlApplied] = useState<{
		applied: number;
		failed: number;
	} | null>(null);
	const [furniDataResult, setFurniDataResult] = useState<{
		added: number;
		removedDuplicates: number;
		removedIdConflicts: number;
	} | null>(null);
	const [structureResult, setStructureResult] = useState<{
		orphanedRemoved: number;
		orphanedCleaned: number;
		duplicatesMerged: number;
		duplicateRowsRemoved: number;
		remappedReferences: number;
	} | null>(null);

	const [checkProgress, setCheckProgress] = useState<{
		section: string;
		current: number;
		total: number;
	} | null>(null);

	const abortRef = useRef<AbortController | null>(null);

	const runAudit = useCallback(async () => {
		setLoading(true);
		setProgress("Starting audit…");
		setIssues([]);
		setMissingFromSources([]);
		setUnrepairable([]);
		setSummary(null);
		setRepairStats(null);
		setNitroRepairStats(null);
		setSqlText(null);
		setSqlApplied(null);
		setFurniDataResult(null);
		setStructureResult(null);
		setCheckProgress(null);
		setActiveTab("issues");

		const abort = new AbortController();
		abortRef.current = abort;

		try {
			const res = await adminFetch("/api/admin/import/audit", {
				method: "POST",
				signal: abort.signal,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					repair: repairEnabled,
					repairNitros,
					sql: generateSql || applySql,
					applySql,
					repairFurniData,
					repairStructure,
					checkFurniDataIds,
				}),
			});

			if (!res.body) {
				toast.error("No response stream");
				setLoading(false);
				return;
			}

			if (!res.headers.get("content-type")?.includes("text/event-stream")) {
				let errMsg = "Audit failed";
				try {
					const json = await res.json();
					errMsg = json.error || errMsg;
				} catch {
					// ignore
				}
				toast.error(errMsg);
				setLoading(false);
				return;
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buf = "";

			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				const parts = buf.split("\n\n");
				buf = parts.pop() ?? "";
				for (const part of parts) {
					if (!part.startsWith("data: ")) continue;
					try {
						const evt = JSON.parse(part.slice(6)) as AuditEvent;

						flushSync(() => {
							if (evt.type === "progress") {
								setProgress(evt.message ?? "");
							}

							if (evt.type === "items_loaded") {
								setProgress(`Loaded ${evt.total} items_base entries`);
							}

							if (evt.type === "catalog_loaded") {
								setProgress(`Loaded ${evt.total} catalog_items entries`);
							}

							if (evt.type === "checking") {
								setProgress(`Checking ${evt.section}…`);
								if (evt.total) {
									setCheckProgress({
										section: evt.section ?? "",
										current: evt.current ?? 0,
										total: evt.total,
									});
								}
							}

							if (evt.type === "repair_complete") {
								if (evt.repair) setRepairStats(evt.repair);
								if (evt.repairNitro) setNitroRepairStats(evt.repairNitro);
							}

							if (evt.type === "sql_ready") {
								setSqlText(evt.sql ?? null);
							}

							if (evt.type === "sql_applied") {
								setSqlApplied({
									applied: evt.applied ?? 0,
									failed: evt.sqlFailed ?? 0,
								});
							}

							if (evt.type === "furnidata_repair_complete") {
								if (evt.furniData) setFurniDataResult(evt.furniData);
							}

							if (evt.type === "structure_repair_complete") {
								if (evt.structure) setStructureResult(evt.structure);
							}

							if (evt.type === "batch_complete") {
								setIssues(evt.issues ?? []);
								setMissingFromSources(evt.missingFromSources ?? []);
								setUnrepairable(evt.unrepairable ?? []);
								if (evt.summary) setSummary(evt.summary);
								setCheckProgress(null);
								setProgress("Done");
								const errCount =
									evt.issues?.filter((i) => i.severity === "error").length ?? 0;
								const warnCount =
									evt.issues?.filter((i) => i.severity === "warning").length ??
									0;
								const legacyCount = evt.unrepairable?.length ?? 0;
								if (errCount > 0) {
									toast.error(`${errCount} error(s) found`);
								} else if (warnCount > 0) {
									toast.warning("Warnings found");
								} else if (legacyCount > 0) {
									toast.info(`${legacyCount} legacy item(s) can't be repaired`);
								} else {
									toast.success("No issues found");
								}
							}

							if (evt.type === "error") {
								setProgress(`ERROR: ${evt.message ?? ""}`);
								toast.error(evt.message ?? "Audit failed");
							}
						});
					} catch {
						// skip parse errors
					}
				}
			}
		} catch (err) {
			if ((err as Error).name !== "AbortError") {
				toast.error("Audit request failed");
			} else {
				toast.info("Audit cancelled");
			}
		} finally {
			setLoading(false);
			abortRef.current = null;
		}
	}, [
		repairEnabled,
		repairNitros,
		generateSql,
		applySql,
		repairFurniData,
		repairStructure,
		checkFurniDataIds,
	]);

	const errors = issues.filter((i) => i.severity === "error");
	const warnings = issues.filter((i) => i.severity === "warning");

	const downloadSql = () => {
		if (!sqlText) return;
		const blob = new Blob([sqlText], { type: "text/sql" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `catalog-repair-${new Date().toISOString().slice(0, 10)}.sql`;
		a.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="space-y-6">
			{!summary && (
				<div className="flex items-center gap-2 flex-wrap">
					<Button onClick={runAudit} disabled={loading} size="lg">
						{loading ? (
							<Loader2 className="w-4 h-4 animate-spin mr-2" />
						) : (
							<ClipboardList className="w-4 h-4 mr-2" />
						)}
						{loading ? progress || "Running…" : "Run Full Catalog Audit"}
					</Button>
					<AuditCheckbox
						checked={repairEnabled}
						disabled={loading}
						onChange={setRepairEnabled}
					>
						Repair missing icons
					</AuditCheckbox>
					<AuditCheckbox
						checked={repairNitros}
						disabled={loading}
						onChange={setRepairNitros}
					>
						Repair missing .nitro
					</AuditCheckbox>
					<AuditCheckbox
						checked={generateSql}
						disabled={loading}
						onChange={setGenerateSql}
					>
						Generate catalog SQL
					</AuditCheckbox>
					<AuditCheckbox
						checked={applySql}
						disabled={loading}
						onChange={setApplySql}
					>
						Apply SQL to database
					</AuditCheckbox>
					<AuditCheckbox
						checked={repairFurniData}
						disabled={loading}
						onChange={setRepairFurniData}
					>
						Repair FurnitureData.json (add missing + dedupe)
					</AuditCheckbox>
					<AuditCheckbox
						checked={checkFurniDataIds}
						disabled={loading}
						onChange={setCheckFurniDataIds}
					>
						Check FurnitureData.json for spriteId conflicts
					</AuditCheckbox>
					<AuditCheckbox
						checked={repairStructure}
						disabled={loading}
						onChange={setRepairStructure}
					>
						Repair structural issues (orphaned refs + duplicates)
					</AuditCheckbox>
					{loading && (
						<Button
							variant="outline"
							size="lg"
							onClick={() => abortRef.current?.abort()}
						>
							Cancel
						</Button>
					)}
				</div>
			)}

			{loading && checkProgress && (
				<div className="text-sm text-muted-foreground">
					{checkProgress.section}: {checkProgress.current} /{" "}
					{checkProgress.total}
				</div>
			)}

			{summary && (
				<>
					{/* Summary cards */}
					<div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
						<div className="rounded-xl border bg-card p-3 sm:p-4 space-y-1">
							<div className="text-xl sm:text-2xl font-bold">
								{summary.totalItemsBase}
							</div>
							<div className="text-xs text-muted-foreground">
								items_base entries
							</div>
						</div>
						<div className="rounded-xl border bg-card p-3 sm:p-4 space-y-1">
							<div className="text-xl sm:text-2xl font-bold">
								{summary.totalCatalogItems}
							</div>
							<div className="text-xs text-muted-foreground">
								catalog_items entries
							</div>
						</div>
						<div
							className={`rounded-xl border p-3 sm:p-4 space-y-1 ${errors.length > 0 ? "border-[var(--admin-error-border)] bg-[var(--admin-error-subtle)]" : "bg-card"}`}
						>
							<div
								className={`text-xl sm:text-2xl font-bold ${errors.length > 0 ? "text-[var(--admin-error)]" : ""}`}
							>
								{errors.length}
							</div>
							<div className="text-xs text-muted-foreground">Errors</div>
						</div>
						<div
							className={`rounded-xl border p-3 sm:p-4 space-y-1 ${warnings.length > 0 ? "border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)]" : "bg-card"}`}
						>
							<div
								className={`text-xl sm:text-2xl font-bold ${warnings.length > 0 ? "text-[var(--admin-warning)]" : ""}`}
							>
								{warnings.length}
							</div>
							<div className="text-xs text-muted-foreground">Warnings</div>
						</div>
					</div>

					{/* Quick stats */}
					<div className="grid gap-2 sm:grid-cols-3 text-sm">
						<div className="flex items-center gap-2">
							{summary.missingCatalog > 0 ? (
								<AlertCircle className="w-4 h-4 text-[var(--admin-warning)]" />
							) : (
								<CheckCircle2 className="w-4 h-4 text-[var(--admin-success)]" />
							)}
							<span>{summary.missingCatalog} items without catalog entry</span>
						</div>
						<div className="flex items-center gap-2">
							{summary.orphanedCatalog > 0 ? (
								<AlertCircle className="w-4 h-4 text-[var(--admin-error)]" />
							) : (
								<CheckCircle2 className="w-4 h-4 text-[var(--admin-success)]" />
							)}
							<span>{summary.orphanedCatalog} orphaned catalog references</span>
						</div>
						<div className="flex items-center gap-2">
							{summary.missingNitro > 0 ? (
								<AlertCircle className="w-4 h-4 text-[var(--admin-error)]" />
							) : (
								<CheckCircle2 className="w-4 h-4 text-[var(--admin-success)]" />
							)}
							<span>{summary.missingNitro} items without .nitro</span>
						</div>
						<div className="flex items-center gap-2">
							{summary.missingIcon > 0 ? (
								<AlertCircle className="w-4 h-4 text-[var(--admin-warning)]" />
							) : (
								<CheckCircle2 className="w-4 h-4 text-[var(--admin-success)]" />
							)}
							<span>{summary.missingIcon} items without icon</span>
						</div>
						<div className="flex items-center gap-2">
							{summary.duplicates > 0 ? (
								<AlertCircle className="w-4 h-4 text-[var(--admin-error)]" />
							) : (
								<CheckCircle2 className="w-4 h-4 text-[var(--admin-success)]" />
							)}
							<span>{summary.duplicates} duplicate classnames</span>
						</div>
						<div className="flex items-center gap-2">
							{summary.missingFromSourcesTotal > 0 ? (
								<AlertCircle className="w-4 h-4 text-[var(--admin-warning)]" />
							) : (
								<CheckCircle2 className="w-4 h-4 text-[var(--admin-success)]" />
							)}
							<span>
								{summary.missingFromSourcesTotal} items missing from clone
								sources
							</span>
						</div>
						<div className="flex items-center gap-2">
							{summary.unrepairableCount > 0 ? (
								<AlertCircle className="w-4 h-4 text-[var(--admin-text-muted)]" />
							) : (
								<CheckCircle2 className="w-4 h-4 text-[var(--admin-success)]" />
							)}
							<span>
								{summary.unrepairableCount} item(s) can't be repaired
								(legacy/broken)
							</span>
						</div>
						{repairStats && (
							<div className="flex items-center gap-2 col-span-full">
								<span className="text-xs text-muted-foreground">
									Icon repair:{" "}
									<span className="text-[var(--admin-success)] font-medium">
										{repairStats.succeeded} fixed
									</span>
									{repairStats.failed > 0 && (
										<>
											{" · "}
											<span className="text-[var(--admin-error)] font-medium">
												{repairStats.failed} failed
											</span>
										</>
									)}
									{repairStats.skipped > 0 && (
										<>
											{" · "}
											<span className="text-[var(--admin-text-muted)]">
												{repairStats.skipped} skipped
											</span>
										</>
									)}
									{repairStats.stillMissing > 0 && (
										<>
											{" · "}
											<span className="text-[var(--admin-warning)] font-medium">
												{repairStats.stillMissing} still missing
											</span>
										</>
									)}
								</span>
							</div>
						)}
						{nitroRepairStats && (
							<div className="flex items-center gap-2 col-span-full">
								<span className="text-xs text-muted-foreground">
									Nitro repair:{" "}
									<span className="text-[var(--admin-success)] font-medium">
										{nitroRepairStats.succeeded} fixed
									</span>
									{nitroRepairStats.failed > 0 && (
										<>
											{" · "}
											<span className="text-[var(--admin-error)] font-medium">
												{nitroRepairStats.failed} failed
											</span>
										</>
									)}
									{nitroRepairStats.skipped > 0 && (
										<>
											{" · "}
											<span className="text-[var(--admin-text-muted)]">
												{nitroRepairStats.skipped} skipped
											</span>
										</>
									)}
									{nitroRepairStats.stillMissing > 0 && (
										<>
											{" · "}
											<span className="text-[var(--admin-warning)] font-medium">
												{nitroRepairStats.stillMissing} still missing
											</span>
										</>
									)}
								</span>
							</div>
						)}
						{sqlText && (
							<div className="flex items-center gap-2 col-span-full">
								<span className="text-xs text-muted-foreground">
									Catalog SQL:{" "}
									<span className="font-medium">
										{summary.catalogSqlCount} statement(s) generated
									</span>
									{sqlApplied && (
										<>
											{" · "}
											<span className="text-[var(--admin-success)] font-medium">
												{sqlApplied.applied} applied
											</span>
											{sqlApplied.failed > 0 && (
												<>
													{" · "}
													<span className="text-[var(--admin-error)] font-medium">
														{sqlApplied.failed} failed
													</span>
												</>
											)}
										</>
									)}
								</span>
								<Button variant="outline" size="sm" onClick={downloadSql}>
									Download .sql
								</Button>
							</div>
						)}
						{furniDataResult && (
							<div className="flex items-center gap-2 col-span-full">
								<span className="text-xs text-muted-foreground">
									FurnitureData repair:{" "}
									<span className="text-[var(--admin-success)] font-medium">
										{furniDataResult.added} added
									</span>
									{furniDataResult.removedDuplicates > 0 && (
										<>
											{" · "}
											<span className="text-[var(--admin-warning)] font-medium">
												{furniDataResult.removedDuplicates} duplicates removed
											</span>
										</>
									)}
									{furniDataResult.removedIdConflicts > 0 && (
										<>
											{" · "}
											<span className="text-[var(--admin-warning)] font-medium">
												{furniDataResult.removedIdConflicts} spriteId conflicts
												fixed
											</span>
										</>
									)}
								</span>
							</div>
						)}
						{structureResult && (
							<div className="flex items-center gap-2 col-span-full">
								<span className="text-xs text-muted-foreground">
									Structural repair:{" "}
									{structureResult.orphanedRemoved > 0 && (
										<>
											<span className="text-[var(--admin-success)] font-medium">
												{structureResult.orphanedRemoved} orphaned rows removed
											</span>
											{" · "}
										</>
									)}
									{structureResult.orphanedCleaned > 0 && (
										<>
											<span className="font-medium">
												{structureResult.orphanedCleaned} cleaned
											</span>
											{" · "}
										</>
									)}
									{structureResult.duplicatesMerged > 0 && (
										<>
											<span className="text-[var(--admin-success)] font-medium">
												{structureResult.duplicatesMerged} classname(s) merged
											</span>
											{" · "}
										</>
									)}
									{structureResult.duplicateRowsRemoved > 0 && (
										<>
											<span className="text-[var(--admin-warning)] font-medium">
												{structureResult.duplicateRowsRemoved} duplicate rows
												removed
											</span>
											{" · "}
										</>
									)}
									<span className="text-[var(--admin-text-muted)]">
										{structureResult.remappedReferences} reference(s) remapped
									</span>
								</span>
							</div>
						)}
					</div>

					{/* Tabs */}
					{issues.length > 0 ||
					missingFromSources.length > 0 ||
					unrepairable.length > 0 ? (
						<div className="border-b border-border">
							<div className="flex gap-4">
								<button
									type="button"
									onClick={() => setActiveTab("issues")}
									className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
										activeTab === "issues"
											? "border-primary text-foreground"
											: "border-transparent text-muted-foreground hover:text-foreground"
									}`}
								>
									Issues ({issues.length})
								</button>
								<button
									type="button"
									onClick={() => setActiveTab("sources")}
									className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
										activeTab === "sources"
											? "border-primary text-foreground"
											: "border-transparent text-muted-foreground hover:text-foreground"
									}`}
								>
									Missing from sources ({missingFromSources.length})
								</button>
								<button
									type="button"
									onClick={() => setActiveTab("unrepairable")}
									className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
										activeTab === "unrepairable"
											? "border-primary text-foreground"
											: "border-transparent text-muted-foreground hover:text-foreground"
									}`}
								>
									Unrepairable (legacy) ({unrepairable.length})
								</button>
							</div>
						</div>
					) : null}

					{/* Issues list */}
					{activeTab === "issues" && issues.length > 0 && (
						<div className="space-y-2">
							{issues.map((issue) => (
								<div
									key={issue.message}
									className={`rounded-xl border p-4 text-sm ${
										issue.severity === "error"
											? "border-[var(--admin-error-border)] bg-[var(--admin-error-subtle)]"
											: issue.severity === "warning"
												? "border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)]"
												: "bg-card"
									}`}
								>
									<div className="flex items-start gap-2">
										<AlertCircle
											className={`w-4 h-4 mt-0.5 shrink-0 ${
												issue.severity === "error"
													? "text-[var(--admin-error)]"
													: issue.severity === "warning"
														? "text-[var(--admin-warning)]"
														: "text-[var(--admin-text-muted)]"
											}`}
										/>
										<div className="space-y-0.5 min-w-0">
											<div className="flex items-center gap-2 flex-wrap">
												<span
													className={`font-medium ${
														issue.severity === "error"
															? "text-[var(--admin-error)]"
															: issue.severity === "warning"
																? "text-[var(--admin-warning)]"
																: "text-[var(--admin-text-muted)]"
													}`}
												>
													{TYPE_LABELS[issue.type] || issue.type}
												</span>
												{issue.classname && (
													<code className="text-xs bg-background/50 px-1.5 py-0.5 rounded font-mono break-all max-w-[200px]">
														{issue.classname}
													</code>
												)}
												{issue.sourceName && (
													<span className="text-xs text-muted-foreground">
														source: {issue.sourceName}
													</span>
												)}
											</div>
											<p className="text-muted-foreground">{issue.message}</p>
										</div>
									</div>
								</div>
							))}
						</div>
					)}

					{/* Missing from sources list */}
					{activeTab === "sources" && missingFromSources.length > 0 && (
						<div className="space-y-2">
							{missingFromSources.map((item) => (
								<div
									key={`${item.sourceId}-${item.classname}`}
									className="rounded-xl border bg-card p-3 text-sm flex items-center gap-2"
								>
									<ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
									<code className="font-mono text-xs">{item.classname}</code>
									<span className="text-xs text-muted-foreground">
										— {item.itemName}
									</span>
									<span className="text-xs text-muted-foreground ml-auto">
										in {item.sourceName}
									</span>
								</div>
							))}
						</div>
					)}

					{/* Unrepairable (legacy) list */}
					{activeTab === "unrepairable" && unrepairable.length > 0 && (
						<div className="space-y-2">
							{unrepairable.map((item) => (
								<div
									key={item.classname}
									className="rounded-xl border bg-card p-3 text-sm flex items-center gap-2"
								>
									<AlertCircle className="w-3.5 h-3.5 text-[var(--admin-text-muted)] shrink-0" />
									<code className="font-mono text-xs">{item.classname}</code>
									<span className="text-xs text-muted-foreground">
										(ID {item.itemId})
									</span>
									<span className="text-xs text-[var(--admin-warning)] ml-auto">
										missing {item.missing.join(" + ")}
									</span>
								</div>
							))}
						</div>
					)}

					{activeTab === "issues" &&
						issues.length === 0 &&
						missingFromSources.length === 0 && (
							<div className="rounded-xl border bg-card p-6 sm:p-12 text-center text-muted-foreground">
								<CheckCircle2 className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 text-[var(--admin-success)]" />
								<p className="text-base sm:text-lg font-medium">
									No issues found
								</p>
								<p className="text-sm">Your catalog is clean!</p>
							</div>
						)}

					<Button
						variant="outline"
						onClick={() => {
							setSummary(null);
							setIssues([]);
							setMissingFromSources([]);
							setUnrepairable([]);
							setRepairStats(null);
							setNitroRepairStats(null);
							setSqlText(null);
							setSqlApplied(null);
							setFurniDataResult(null);
							setStructureResult(null);
							setProgress("");
							setCheckProgress(null);
						}}
					>
						Run Again
					</Button>
				</>
			)}

			{!loading && !summary && (
				<div className="rounded-xl border bg-card p-6 sm:p-12 text-center text-muted-foreground">
					<SearchX className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 opacity-40" />
					<p>
						Run a full audit to check for missing catalog entries, broken
						references, missing files, and items available from clone sources.
					</p>
				</div>
			)}
		</div>
	);
}
