"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
	AlertTriangle,
	CheckCircle2,
	Clock,
	Download,
	FileX2,
	Loader2,
	ScanSearch,
	ScrollText,
	Sparkles,
	Trash2,
	Wrench,
	X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { adminFetch } from "@/lib/admin-fetch";
import { formatBytes } from "@/lib/services/disk-usage";
import { readSseStream } from "@/lib/sse-client";

interface AssetEntry {
	fileName: string;
	base: string;
	size: number;
	dirs: string[];
	lastModified: number;
	error?: string;
}

type GroupKey = "fake" | "broken" | "orphanedSwf" | "orphanedIcon";

interface ScanData {
	fake: AssetEntry[];
	broken: AssetEntry[];
	orphanedSwf: AssetEntry[];
	orphanedIcon: AssetEntry[];
	total: number;
	cached: boolean;
}

interface ScanSession {
	id: string;
	state: "running" | "done" | "cancelled" | "error";
	startedAt: string;
	updatedAt: string;
	force?: boolean;
	progress?: { phase: string; scanned: number };
	cached?: boolean;
	total?: number;
	error?: string;
}

/**
 * The gamedata cleanup reports its own shape instead of importing the scan
 * module, which pulls in `node:fs` and cannot be bundled for the browser.
 */
interface GamedataPlan {
	duplicates: Array<{
		classname: string;
		section: string;
		removeIndexes: number[];
		keepIndex: number;
		hasNitro: boolean;
		hasIcon: boolean;
		differsFromSurvivor: boolean;
	}>;
	crossSection: Array<{ classname: string; sections: string[] }>;
	orphans: Array<{ classname: string; section: string }>;
	figureMapIssues: Array<{
		libraryId: string;
		reason: string;
		partId: number | null;
		partType: string;
	}>;
	figureDataIssues: Array<{
		reason: string;
		id: number;
		setType?: string;
	}>;
	warnings: string[];
}

type GamedataPass =
	| "dedupeFurnitureData"
	| "cleanFurnitureData"
	| "cleanFigureMap"
	| "cleanFigureData";

/** Display order also documents that the passes are not interchangeable. */
const GAMEDATA_PASSES: GamedataPass[] = [
	"dedupeFurnitureData",
	"cleanFurnitureData",
	"cleanFigureMap",
	"cleanFigureData",
];

interface DeleteResponse {
	deleted: number;
	copiesRemoved: number;
	errors?: string[];
}

interface RepairResponse {
	repaired: number;
	failed: number;
	errors?: string[];
}

interface AutoCleanResponse {
	deleted: number;
	copiesRemoved: number;
	skippedRecent: number;
	skippedBroken: number;
	errors?: string[];
}

interface HistoryEntry {
	triggeredAt: string;
	triggeredBy: "manual" | "scheduled";
	maxAgeDays: number;
	deleted: number;
	copiesRemoved: number;
	skippedRecent: number;
	skippedBroken: number;
	errors: string[];
}

type GroupTone = "error" | "warning" | "neutral";
type AssetKind = "nitro" | "swf" | "icon";

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_POLL_MS = 1500;
const DATA_IDLE_TIMEOUT_MS = 90_000;
const SESSION_URL = "/api/admin/studio/nitro-cleanup/session";
const DATA_URL = "/api/admin/studio/nitro-cleanup";

function ageLabel(t: (key: string) => string, lastModified: number): string {
	if (!lastModified) return t("ageUnknown");
	const days = Math.floor((Date.now() - lastModified) / DAY_MS);
	if (days < 1) return t("ageBelow");
	if (days < 30) return `${days}d`;
	if (days < 365) return `${Math.floor(days / 30)}mo`;
	return `${Math.floor(days / 365)}y`;
}

function downloadJson(filename: string, data: unknown): void {
	const blob = new Blob([JSON.stringify(data, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

/**
 * Virtualized list for one cleanup group. Directories can hold tens of
 * thousands of leftover files; only the visible rows are mounted as DOM nodes,
 * so the tab never freezes no matter how long the list is.
 */
function VirtualAssetList({
	entries,
	selected,
	disabled = false,
	onToggle,
	copiesLabel,
	formatAge,
}: {
	entries: AssetEntry[];
	selected: Set<string>;
	disabled?: boolean;
	onToggle: (fileName: string) => void;
	copiesLabel: string;
	formatAge: (lastModified: number) => string;
}) {
	const parentRef = useRef<HTMLDivElement>(null);
	const virtualizer = useVirtualizer({
		count: entries.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 30,
		overscan: 10,
	});

	return (
		<div
			ref={parentRef}
			className="max-h-80 overflow-auto rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2"
		>
			<div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
				{virtualizer.getVirtualItems().map((virtualItem) => {
					const entry = entries[virtualItem.index];
					return (
						<div
							key={entry.fileName}
							data-index={virtualItem.index}
							ref={virtualizer.measureElement}
							className="absolute left-0 top-0 flex w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-[var(--admin-accent)]/5"
							style={{
								height: virtualItem.size,
								transform: `translateY(${virtualItem.start}px)`,
							}}
						>
							<Checkbox
								style={{ display: "inline-flex", width: 16, height: 16 }}
								className="border-[var(--admin-border)] bg-[var(--admin-surface)] data-checked:border-[var(--admin-accent)] data-checked:bg-[var(--admin-accent)] data-checked:text-[var(--admin-accent-foreground)]"
								checked={selected.has(entry.fileName)}
								disabled={disabled}
								onCheckedChange={() => onToggle(entry.fileName)}
								aria-label={`Select ${entry.fileName}`}
							/>
							<code className="min-w-0 flex-1 truncate font-mono text-xs">
								{entry.fileName}
							</code>
							<span className="shrink-0 text-xs text-[var(--admin-text-muted)]">
								{formatBytes(entry.size)}
							</span>
							<span className="shrink-0 text-xs text-[var(--admin-text-muted)]">
								{formatAge(entry.lastModified)}
							</span>
							{entry.error && (
								<span
									title={entry.error}
									className="hidden max-w-[320px] truncate text-xs text-[var(--admin-error)] lg:block"
								>
									{entry.error}
								</span>
							)}
							{entry.dirs.length > 1 && (
								<span className="shrink-0 rounded bg-[var(--admin-accent)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--admin-text-muted)]">
									{copiesLabel.replace("{count}", String(entry.dirs.length))}
								</span>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function CleanupGroup({
	label,
	description,
	tone,
	entries,
	selected,
	disabled = false,
	onToggle,
	onToggleAll,
	emptyLabel,
	selectedLabel,
	copiesLabel,
	formatAge,
}: {
	label: string;
	description: string;
	tone: GroupTone;
	entries: AssetEntry[];
	selected: Set<string>;
	disabled?: boolean;
	onToggle: (fileName: string) => void;
	onToggleAll: (names: string[]) => void;
	emptyLabel: string;
	selectedLabel: string;
	copiesLabel: string;
	formatAge: (lastModified: number) => string;
}) {
	const checked = entries.filter((e) => selected.has(e.fileName));
	const allChecked = entries.length > 0 && checked.length === entries.length;
	const toneClass =
		tone === "error"
			? "border-[var(--admin-error-border)] bg-[var(--admin-error-subtle)]"
			: tone === "warning"
				? "border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)]"
				: "border-[var(--admin-border)] bg-[var(--admin-surface)]";

	return (
		<section className="space-y-2">
			<div
				className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 ${entries.length > 0 ? toneClass : "border-[var(--admin-border)] bg-[var(--admin-surface)]"}`}
			>
				<Checkbox
					style={{ display: "inline-flex", width: 18, height: 18 }}
					className="border-[var(--admin-border)] bg-[var(--admin-surface)] data-checked:border-[var(--admin-accent)] data-checked:bg-[var(--admin-accent)] data-checked:text-[var(--admin-accent-foreground)]"
					checked={allChecked}
					disabled={disabled || entries.length === 0}
					onCheckedChange={() => onToggleAll(entries.map((e) => e.fileName))}
					aria-label={`Select all ${label}`}
				/>
				<div className="min-w-0 flex-1">
					<h3
						className={`text-sm font-medium ${entries.length > 0 ? "text-[var(--admin-text)]" : "text-[var(--admin-text-muted)]"}`}
					>
						{label} ({entries.length})
					</h3>
					<p className="text-xs text-[var(--admin-text-muted)]">
						{description}
					</p>
				</div>
				{checked.length > 0 && (
					<span className="text-xs font-medium text-[var(--admin-accent)]">
						{selectedLabel.replace("{count}", String(checked.length))}
					</span>
				)}
			</div>

			{entries.length === 0 ? (
				<p className="flex items-center gap-1.5 px-2 text-xs text-[var(--admin-success)]">
					<CheckCircle2 size={13} />
					{emptyLabel}
				</p>
			) : (
				<VirtualAssetList
					entries={entries}
					selected={selected}
					disabled={disabled}
					onToggle={onToggle}
					copiesLabel={copiesLabel}
					formatAge={formatAge}
				/>
			)}
		</section>
	);
}

export function NitroCleanupPanel() {
	const t = useTranslations("admin.studio.nitroCleanup");
	const formatAge = (lastModified: number): string => ageLabel(t, lastModified);

	const [scanning, setScanning] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [repairing, setRepairing] = useState(false);
	const [autoCleaning, setAutoCleaning] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [loading, setLoading] = useState(false);
	const [autoAge, setAutoAge] = useState(30);
	const [minAgeDays, setMinAgeDays] = useState(0);
	const [onlyOld, setOnlyOld] = useState(false);
	const [session, setSession] = useState<ScanSession | null>(null);
	const [attachedToExisting, setAttachedToExisting] = useState(false);
	const [scan, setScan] = useState<ScanData | null>(null);
	const [history, setHistory] = useState<HistoryEntry[]>([]);
	const [showHistory, setShowHistory] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [selectedSwf, setSelectedSwf] = useState<Set<string>>(new Set());
	const [selectedIcon, setSelectedIcon] = useState<Set<string>>(new Set());
	const [repairProgress, setRepairProgress] = useState<{
		completed: number;
		total: number;
		ok: number;
		failed: number;
	} | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const loadAbortRef = useRef<AbortController | null>(null);
	const [gamedataPlan, setGamedataPlan] = useState<GamedataPlan | null>(null);
	const [gamedataLoading, setGamedataLoading] = useState(false);
	const [gamedataRunning, setGamedataRunning] = useState(false);
	const [gamedataPasses, setGamedataPasses] = useState<Set<GamedataPass>>(
		new Set(GAMEDATA_PASSES),
	);
	const [gamedataMaxRemovals, setGamedataMaxRemovals] = useState(0);
	const [gamedataLimitError, setGamedataLimitError] = useState<{
		pass: string;
		wouldRemove: number;
		maxRemovals: number;
		partial: Record<string, Record<string, number>>;
	} | null>(null);
	const { confirm, dialog } = useConfirmDialog();
	// Latest filter values, read from effects without putting them in deps.
	const filterRef = useRef({ onlyOld, minAgeDays });
	useEffect(() => {
		filterRef.current = { onlyOld, minAgeDays };
	});

	const busy =
		scanning ||
		deleting ||
		repairing ||
		autoCleaning ||
		exporting ||
		gamedataRunning;
	const running = session?.state === "running" || (scanning && !session);

	const fetchSession = useCallback(async (): Promise<ScanSession | null> => {
		const res = await adminFetch(SESSION_URL, {
			headers: { Accept: "application/json" },
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { session?: ScanSession | null };
		return data.session ?? null;
	}, []);

	/** Assemble the persisted result from the chunked /data stream. */
	const loadData = useCallback(async (minAge: number): Promise<void> => {
		loadAbortRef.current?.abort();
		const abort = new AbortController();
		loadAbortRef.current = abort;
		setLoading(true);
		const params = new URLSearchParams();
		if (minAge > 0) params.set("minAgeDays", String(minAge));
		const holder: {
			summary: {
				total: number;
				cached: boolean;
				groups: Record<GroupKey, number>;
			} | null;
			arrays: Partial<Record<GroupKey, AssetEntry[]>>;
			error: string | null;
		} = { summary: null, arrays: {}, error: null };
		try {
			const res = await adminFetch(
				`${DATA_URL}${params.size > 0 ? `?${params.toString()}` : ""}`,
				{
					headers: { Accept: "text/event-stream" },
					signal: abort.signal,
					credentials: "same-origin",
				},
			);
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(
					typeof body?.error === "string"
						? body.error
						: `Failed to load scan result (HTTP ${res.status})`,
				);
			}
			if (!res.body) throw new Error("No response stream");
			await readSseStream(
				res.body,
				(evt) => {
					if (evt.type === "summary") {
						holder.summary = {
							total: Number(evt.total ?? 0),
							cached: evt.cached === true,
							groups: (evt.groups as Record<GroupKey, number>) ?? {
								fake: 0,
								broken: 0,
								orphanedSwf: 0,
								orphanedIcon: 0,
							},
						};
						for (const group of Object.keys(
							holder.summary.groups,
						) as GroupKey[]) {
							holder.arrays[group] = new Array(
								holder.summary.groups[group] ?? 0,
							).fill(null);
						}
					} else if (evt.type === "chunk") {
						const group = evt.group as GroupKey;
						const offset = Number(evt.offset ?? 0);
						const entries = (evt.entries ?? []) as AssetEntry[];
						const target = holder.arrays[group];
						if (target) {
							for (let i = 0; i < entries.length; i++) {
								target[offset + i] = entries[i];
							}
						}
					} else if (evt.type === "error") {
						holder.error = String(evt.message ?? "Failed to load scan result");
					}
				},
				abort.signal,
				DATA_IDLE_TIMEOUT_MS,
			);
			if (holder.error) throw new Error(holder.error);
			if (abort.signal.aborted) return;
			if (!holder.summary) throw new Error("No scan result yet");
			const arr = (g: GroupKey): AssetEntry[] =>
				(holder.arrays[g] ?? []) as AssetEntry[];
			setScan({
				fake: arr("fake"),
				broken: arr("broken"),
				orphanedSwf: arr("orphanedSwf"),
				orphanedIcon: arr("orphanedIcon"),
				total: holder.summary.total,
				cached: holder.summary.cached,
			});
		} catch (err) {
			if ((err as Error).name !== "AbortError" && !abort.signal.aborted) {
				toast.error(
					err instanceof Error ? err.message : "Failed to load scan result",
				);
			}
		} finally {
			setLoading(false);
			if (loadAbortRef.current === abort) loadAbortRef.current = null;
		}
	}, []);

	/** Attach to whatever scan is currently persisted, restarting the poll
	 * when a new one begins in another tab. */
	useEffect(() => {
		let active = true;
		const attach = async () => {
			const s = await fetchSession();
			if (active) setSession(s);
		};
		void attach();
		return () => {
			active = false;
		};
	}, [fetchSession]);

	// Poll while a scan is running; the detached server process keeps updating
	// the session file even if this exact tab reloaded between polls.
	useEffect(() => {
		if (session?.state !== "running") return;
		const timer = setInterval(async () => {
			const s = await fetchSession();
			if (s) setSession(s);
		}, SESSION_POLL_MS);
		return () => clearInterval(timer);
	}, [session?.state, fetchSession]);

	// When the persisted session turns done, load the result (also covers the
	// very first mount where a previous scan already completed). Filter changes
	// re-fetch through the toggle handlers; the effect is idempotent while the
	// session object stays the same, and running sessions no-op here.
	useEffect(() => {
		if (session?.state === "error" && session.error) {
			toast.error(session.error);
		}
		if (session?.state === "done") {
			const filter = filterRef.current;
			void loadData(filter.onlyOld ? filter.minAgeDays : 0);
		}
	}, [session, loadData]);

	useEffect(() => {
		const loadHistory = async () => {
			const res = await adminFetch("/api/admin/studio/nitro-cleanup/history", {
				headers: { Accept: "application/json" },
			});
			if (!res.ok) return;
			const data = (await res.json()) as { history?: HistoryEntry[] };
			setHistory(data.history ?? []);
		};
		void loadHistory();
	}, []);

	const startScan = useCallback(
		async (force: boolean) => {
			if (busy || running) return;
			setScanning(true);
			setAttachedToExisting(false);
			try {
				const res = await adminFetch("/api/admin/studio/nitro-cleanup/run", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ force }),
				});
				const data = (await res.json()) as {
					session?: ScanSession;
					conflict?: boolean;
					error?: string;
				};
				if (!res.ok || !data.session) {
					throw new Error(
						data.error || `Failed to start scan (HTTP ${res.status})`,
					);
				}
				setSession(data.session);
				setScan(null);
				setSelected(new Set());
				setSelectedSwf(new Set());
				setSelectedIcon(new Set());
				if (data.conflict) {
					setAttachedToExisting(true);
					toast.info(t("alreadyRunning"));
				}
			} catch (err) {
				toast.error(
					err instanceof Error ? err.message : "Failed to start scan",
				);
			} finally {
				setScanning(false);
			}
		},
		[busy, running, t],
	);

	const cancelScan = useCallback(async () => {
		await adminFetch("/api/admin/studio/nitro-cleanup/cancel", {
			method: "POST",
			headers: { Accept: "application/json" },
		});
		setScanning(false);
	}, []);

	const toggle = (kind: AssetKind) => (fileName: string) => {
		const setter =
			kind === "swf"
				? setSelectedSwf
				: kind === "icon"
					? setSelectedIcon
					: setSelected;
		setter((prev) => {
			const next = new Set(prev);
			if (next.has(fileName)) next.delete(fileName);
			else next.add(fileName);
			return next;
		});
	};

	const toggleAll = (kind: AssetKind) => (names: string[]) => {
		const setter =
			kind === "swf"
				? setSelectedSwf
				: kind === "icon"
					? setSelectedIcon
					: setSelected;
		setter((prev) => {
			const next = new Set(prev);
			const allChecked = names.every((n) => next.has(n));
			for (const name of names) {
				if (allChecked) next.delete(name);
				else next.add(name);
			}
			return next;
		});
	};

	const totalSelected = selected.size + selectedSwf.size + selectedIcon.size;

	/** Drop deleted/attempted files from the loaded scan without re-scanning. */
	const dropFromScan = (kind: AssetKind, names: string[], removed = 0) => {
		const remove = new Set(names);
		if (remove.size === 0) return;
		setScan((prev) => {
			if (!prev) return prev;
			const drop = <T extends { fileName: string }>(list: T[]): T[] =>
				list.filter((entry) => !remove.has(entry.fileName));
			return {
				...prev,
				fake: kind === "nitro" ? drop(prev.fake) : prev.fake,
				broken: kind === "nitro" ? drop(prev.broken) : prev.broken,
				orphanedSwf: kind === "swf" ? drop(prev.orphanedSwf) : prev.orphanedSwf,
				orphanedIcon:
					kind === "icon" ? drop(prev.orphanedIcon) : prev.orphanedIcon,
				total: Math.max(0, prev.total - removed),
			};
		});
	};

	const removeSelected = async () => {
		const groups: Array<{ kind: AssetKind; names: string[] }> = [];
		for (const [kind, set] of [
			["nitro", selected],
			["swf", selectedSwf],
			["icon", selectedIcon],
		] as const) {
			const names = [...set];
			if (names.length > 0) groups.push({ kind, names });
		}
		if (groups.length === 0) return;
		const confirmed = await confirm({
			title: t("confirmDeleteTitle", { count: totalSelected }),
			description: t("confirmDeleteDescription"),
			confirmLabel: t("confirmDeleteLabel"),
			variant: "danger",
		});
		if (!confirmed) return;
		setDeleting(true);
		try {
			let copiesRemoved = 0;
			let deleted = 0;
			let hadErrors = false;
			for (const group of groups) {
				const res = await adminFetch(DATA_URL, {
					method: "DELETE",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						fileNames: group.names.sort(),
						kind: group.kind,
					}),
				});
				const data = (await res.json()) as DeleteResponse & {
					error?: string;
				};
				if (!res.ok) throw new Error(data.error || "Delete failed");
				deleted += data.deleted ?? 0;
				copiesRemoved += data.copiesRemoved ?? 0;
				if (data.errors?.length) hadErrors = true;
				dropFromScan(group.kind, group.names, data.deleted ?? 0);
			}
			if (hadErrors) {
				toast.warning(t("toastDeletePartial", { copies: copiesRemoved }));
			} else {
				toast.success(t("toastDeleteDone", { copies: copiesRemoved, deleted }));
			}
			setSelected(new Set());
			setSelectedSwf(new Set());
			setSelectedIcon(new Set());
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Delete failed");
		} finally {
			setDeleting(false);
		}
	};

	const repairSelected = async () => {
		const fileNames = [...selected]
			.filter((name) => scan?.broken.some((e) => e.fileName === name))
			.sort();
		if (fileNames.length === 0) return;
		const confirmed = await confirm({
			title: t("confirmRepairTitle", { count: fileNames.length }),
			description: t("confirmRepairDescription"),
			confirmLabel: t("confirmRepairLabel"),
			variant: "default",
		});
		if (!confirmed) return;
		abortRef.current?.abort();
		setRepairing(true);
		setRepairProgress(null);
		const abort = new AbortController();
		abortRef.current = abort;

		const holder: { result: RepairResponse | null } = { result: null };
		let lastError: string | null = null;
		try {
			const res = await adminFetch("/api/admin/studio/nitro-cleanup/rebuild", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "text/event-stream",
				},
				body: JSON.stringify({ fileNames }),
				signal: abort.signal,
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(
					typeof body?.error === "string"
						? body.error
						: `Repair failed (HTTP ${res.status})`,
				);
			}
			if (!res.body) throw new Error("Repair returned no response body");

			await readSseStream(
				res.body,
				(evt) => {
					if (evt.type === "progress") {
						setRepairProgress({
							completed: Number(evt.completed ?? 0),
							total: Number(evt.total ?? fileNames.length),
							ok: Number(evt.ok ?? 0),
							failed: Number(evt.failed ?? 0),
						});
					} else if (evt.type === "result") {
						holder.result = {
							repaired: Number(evt.repaired ?? 0),
							failed: Number(evt.failed ?? 0),
							errors: Array.isArray(evt.errors)
								? evt.errors.map(String)
								: undefined,
						};
					} else if (evt.type === "error") {
						lastError = String(evt.message ?? "Repair failed");
					}
				},
				abort.signal,
				120_000,
			);

			if (lastError) throw new Error(lastError);
			const data = holder.result;
			if (data && data.repaired > 0) {
				toast.success(t("toastRepairDone", { count: data.repaired }));
			} else if (data) {
				toast.warning(t("toastRepairFailed", { failed: data.failed }));
			}
			// Only drop the attempted bundles when every one succeeded; partial
			// failures stay visible so they can be retried.
			if (data && data.repaired >= fileNames.length) {
				dropFromScan("nitro", fileNames);
			}
			setSelected(new Set());
		} catch (err) {
			if ((err as Error).name === "AbortError") {
				toast.info(t("toastRepairCancelled"));
			} else {
				toast.error(err instanceof Error ? err.message : "Repair failed");
			}
		} finally {
			setRepairing(false);
			setRepairProgress(null);
			if (abortRef.current === abort) abortRef.current = null;
		}
	};

	const autoClean = async () => {
		if (scan === null) return;
		const confirmed = await confirm({
			title: t("confirmAutoCleanTitle", { days: autoAge }),
			description: t("confirmAutoCleanDescription"),
			confirmLabel: t("confirmAutoCleanLabel"),
			variant: "danger",
		});
		if (!confirmed) return;
		setAutoCleaning(true);
		try {
			const res = await adminFetch(
				"/api/admin/studio/nitro-cleanup/auto-clean",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ maxAgeDays: autoAge }),
				},
			);
			const data = (await res.json()) as AutoCleanResponse & {
				error?: string;
			};
			if (!res.ok) throw new Error(data.error || "Auto-clean failed");
			if (data.deleted > 0) {
				toast.success(
					t("toastAutoCleanDone", {
						deleted: data.deleted,
						copies: data.copiesRemoved,
						recent: data.skippedRecent,
						broken: data.skippedBroken,
					}),
				);
				const removable = (scan.fake ?? [])
					.filter(
						(entry) =>
							Math.floor((Date.now() - entry.lastModified) / DAY_MS) >= autoAge,
					)
					.map((entry) => entry.fileName);
				dropFromScan("nitro", removable, data.deleted);
			} else {
				toast.info(
					t("toastAutoCleanNothing", {
						recent: data.skippedRecent,
						broken: data.skippedBroken,
					}),
				);
			}
			const hres = await adminFetch("/api/admin/studio/nitro-cleanup/history", {
				headers: { Accept: "application/json" },
			});
			const hdata = (await hres.json()) as { history?: HistoryEntry[] };
			setHistory(hdata.history ?? []);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Auto-clean failed");
		} finally {
			setAutoCleaning(false);
		}
	};

	const loadGamedataPlan =
		useCallback(async (): Promise<GamedataPlan | null> => {
			setGamedataLoading(true);
			try {
				const res = await adminFetch(
					"/api/admin/studio/nitro-cleanup/gamedata",
					{ headers: { Accept: "application/json" } },
				);
				const data = (await res.json()) as {
					plan?: GamedataPlan;
					error?: string;
				};
				if (!res.ok) throw new Error(data.error || "Preview failed");
				setGamedataPlan(data.plan ?? null);
				return data.plan ?? null;
			} catch (err) {
				toast.error(
					err instanceof Error ? err.message : "Gamedata preview failed",
				);
				return null;
			} finally {
				setGamedataLoading(false);
			}
		}, []);

	const toggleGamedataPass = (pass: GamedataPass) => {
		setGamedataPasses((prev) => {
			const next = new Set(prev);
			if (next.has(pass)) next.delete(pass);
			else next.add(pass);
			return next;
		});
	};

	const runGamedataCleanup = async (maxRemovals?: number) => {
		const plan = gamedataPlan ?? (await loadGamedataPlan());
		if (!plan) return;
		if (gamedataPasses.size === 0) {
			toast.error(t("gamedataNothingSelected"));
			return;
		}
		const confirmed = await confirm({
			title: t("gamedataConfirmTitle"),
			description: t("gamedataConfirmDescription", {
				duplicates: plan.duplicates.length,
				orphans: plan.orphans.length,
				figureMap: plan.figureMapIssues.length,
				figureData: plan.figureDataIssues.length,
				passes: gamedataPasses.size,
			}),
			confirmLabel: t("gamedataConfirmLabel"),
			variant: "danger",
		});
		if (!confirmed) return;
		setGamedataRunning(true);
		setGamedataLimitError(null);
		try {
			const res = await adminFetch(
				"/api/admin/studio/nitro-cleanup/gamedata/run",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						confirm: true,
						passes: [...gamedataPasses],
						...(maxRemovals === undefined ? {} : { maxRemovals }),
					}),
				},
			);
			const data = (await res.json()) as {
				result?: Record<string, Record<string, number>>;
				error?: string;
				pass?: string;
				wouldRemove?: number;
				maxRemovals?: number;
				partial?: Record<string, Record<string, number>>;
			};
			if (res.status === 409) {
				// A pass refused to write. Nothing was written by that pass, so
				// the files are as they were; the operator decides whether the
				// limit was wrong or the paths are.
				setGamedataLimitError({
					pass: data.pass ?? "",
					wouldRemove: data.wouldRemove ?? 0,
					maxRemovals: data.maxRemovals ?? 0,
					partial: data.partial ?? {},
				});
				toast.error(data.error || "Gamedata cleanup refused");
				await loadGamedataPlan();
				return;
			}
			if (!res.ok) throw new Error(data.error || "Gamedata cleanup failed");
			const removed = Object.values(data.result ?? {}).reduce(
				(total, counts) =>
					total + Object.values(counts).reduce((sum, n) => sum + n, 0),
				0,
			);
			if (removed > 0) toast.success(t("gamedataToastDone", { removed }));
			else toast.info(t("gamedataToastNothing"));
			// Re-read: the plan is derived from files this just rewrote.
			await loadGamedataPlan();
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Gamedata cleanup failed",
			);
		} finally {
			setGamedataRunning(false);
		}
	};

	const exportManifest = async () => {
		if (scan === null) return;
		setExporting(true);
		try {
			const res = await adminFetch(`${DATA_URL}?full=1`, {
				headers: { Accept: "application/json" },
			});
			const data = (await res.json()) as ScanData & {
				error?: string;
			};
			if (!res.ok || data.error) {
				throw new Error(data.error || `Export failed (HTTP ${res.status})`);
			}
			const entries = {
				scannedAt: new Date().toISOString(),
				total: data.total ?? 0,
				fake: data.fake ?? [],
				broken: data.broken ?? [],
				orphanedSwf: data.orphanedSwf ?? [],
				orphanedIcon: data.orphanedIcon ?? [],
				selected: {
					nitro: [...selected].sort(),
					swf: [...selectedSwf].sort(),
					icon: [...selectedIcon].sort(),
				},
			};
			downloadJson(`nitro-cleanup-scan-${Date.now()}.json`, entries);
			toast.success(t("toastManifestDownload"));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Export failed");
		} finally {
			setExporting(false);
		}
	};

	const toggleOnlyOld = (value: boolean) => {
		setOnlyOld(value);
		const threshold = value ? Math.max(0, minAgeDays) : 0;
		if (session?.state === "done") void loadData(threshold);
	};

	const changeMinAgeDays = (value: number) => {
		const days = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
		setMinAgeDays(days);
		if (onlyOld && session?.state === "done") void loadData(days);
	};

	const phaseLabel = (phase: string): string =>
		phase === "stems"
			? t("phaseStems")
			: phase === "readdir"
				? t("phaseReaddir")
				: phase === "validate"
					? t("phaseValidate")
					: t("phaseScanning");

	const groupProps = (
		key: GroupKey,
	): {
		label: string;
		description: string;
		tone: GroupTone;
	} => {
		switch (key) {
			case "fake":
				return {
					label: t("groupFakeLabel"),
					description: t("groupFakeDescription"),
					tone: "error",
				};
			case "broken":
				return {
					label: t("groupBrokenLabel"),
					description: t("groupBrokenDescription"),
					tone: "warning",
				};
			case "orphanedSwf":
				return {
					label: t("groupSwfLabel"),
					description: t("groupSwfDescription"),
					tone: "warning",
				};
			default:
				return {
					label: t("groupIconLabel"),
					description: t("groupIconDescription"),
					tone: "neutral",
				};
		}
	};

	return (
		<div className="space-y-4">
			{dialog}
			<div className="flex flex-wrap items-center gap-2">
				<Button
					onClick={() => startScan(true)}
					disabled={busy || running}
					size="lg"
				>
					{running ? (
						<Loader2 className="w-4 h-4 animate-spin mr-2" />
					) : (
						<ScanSearch className="w-4 h-4 mr-2" />
					)}
					{running ? t("scanningAssets") : t("scanButton")}
				</Button>
				{running && (
					<Button
						variant="outline"
						size="lg"
						disabled={deleting || repairing || autoCleaning}
						onClick={cancelScan}
					>
						<X className="w-4 h-4 mr-2" />
						{t("cancelButton")}
					</Button>
				)}
				{scan && scan.fake.length > 0 && (
					<>
						<Button size="lg" disabled={busy || running} onClick={autoClean}>
							{autoCleaning ? (
								<Loader2 className="w-4 h-4 animate-spin mr-2" />
							) : (
								<Sparkles className="w-4 h-4 mr-2" />
							)}
							{autoCleaning ? t("cleaning") : t("autoClean")}
						</Button>
						<div className="flex items-center gap-1.5">
							<Input
								type="number"
								min={0}
								className="w-20"
								value={autoAge}
								disabled={busy || running}
								onChange={(e) => setAutoAge(Number(e.target.value))}
								aria-label={t("autoAgeLabel")}
							/>
							<span className="text-xs text-[var(--admin-text-muted)]">
								{t("daysLabel")}
							</span>
						</div>
					</>
				)}
				{scan && (
					<Button
						variant="outline"
						size="lg"
						disabled={busy || running}
						onClick={exportManifest}
					>
						{exporting ? (
							<Loader2 className="w-4 h-4 animate-spin mr-2" />
						) : (
							<Download className="w-4 h-4 mr-2" />
						)}
						{exporting ? t("exporting") : t("exportManifest")}
					</Button>
				)}
			</div>

			{running && session?.progress && (
				<div className="flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-sm text-[var(--admin-text-muted)]">
					<Loader2 className="w-4 h-4 animate-spin shrink-0" />
					{phaseLabel(session.progress.phase)}
					{session.progress.scanned > 0 && (
						<span className="font-mono text-xs">
							{t("scanProgressFiles", {
								count: session.progress.scanned,
							})}
						</span>
					)}
					{attachedToExisting && (
						<span className="text-xs text-[var(--admin-accent)]">
							{t("attachedNotice")}
						</span>
					)}
				</div>
			)}

			{repairing && repairProgress && (
				<div className="flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-sm text-[var(--admin-text-muted)]">
					<Loader2 className="w-4 h-4 animate-spin shrink-0" />
					{t("redownloading")}
					<span className="font-mono text-xs">
						{repairProgress.completed}/{repairProgress.total} —{" "}
						{t("repairProgress", {
							ok: repairProgress.ok,
							failed: repairProgress.failed,
						})}
					</span>
				</div>
			)}

			{session?.state === "cancelled" && (
				<p className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs text-[var(--admin-text-muted)]">
					{t("sessionCancelled")}
				</p>
			)}

			<div className="space-y-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex items-center gap-2 text-sm font-medium">
						<Wrench className="w-4 h-4 shrink-0" />
						{t("gamedataTitle")}
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={gamedataLoading || busy}
							onClick={() => loadGamedataPlan()}
						>
							{gamedataLoading ? (
								<Loader2 className="w-4 h-4 animate-spin mr-2" />
							) : (
								<ScanSearch className="w-4 h-4 mr-2" />
							)}
							{gamedataLoading ? t("gamedataScanning") : t("gamedataScan")}
						</Button>
						<Button
							size="sm"
							disabled={busy || gamedataPlan === null}
							onClick={() => {
								void runGamedataCleanup();
							}}
						>
							{gamedataRunning ? (
								<Loader2 className="w-4 h-4 animate-spin mr-2" />
							) : (
								<Sparkles className="w-4 h-4 mr-2" />
							)}
							{gamedataRunning ? t("gamedataRunning") : t("gamedataRun")}
						</Button>
					</div>
				</div>

				<p className="text-xs text-[var(--admin-text-muted)]">
					{t("gamedataHint")}
				</p>

				{gamedataPlan === null ? (
					<p className="text-xs text-[var(--admin-text-muted)]">
						{t("gamedataNoResult")}
					</p>
				) : (
					<>
						<div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
							{(
								[
									["duplicates", gamedataPlan.duplicates.length],
									["orphans", gamedataPlan.orphans.length],
									["figureMap", gamedataPlan.figureMapIssues.length],
									["figureData", gamedataPlan.figureDataIssues.length],
								] as const
							).map(([key, count]) => (
								<div
									key={key}
									className="rounded border border-[var(--admin-border)] px-2 py-1.5"
								>
									<div className="text-[var(--admin-text-muted)]">
										{t(`gamedataCount_${key}`)}
									</div>
									<div className="font-mono text-sm font-medium">{count}</div>
								</div>
							))}
						</div>

						<div className="space-y-1.5">
							{GAMEDATA_PASSES.map((pass) => (
								<div key={pass} className="flex items-start gap-2 text-xs">
									<Checkbox
										id={`gamedata-pass-${pass}`}
										checked={gamedataPasses.has(pass)}
										disabled={busy}
										onCheckedChange={() => toggleGamedataPass(pass)}
										className="mt-0.5"
									/>
									<label
										htmlFor={`gamedata-pass-${pass}`}
										className="cursor-pointer"
									>
										<span className="font-medium">
											{t(`gamedataPass_${pass}`)}
										</span>
										<span className="block text-[var(--admin-text-muted)]">
											{t(`gamedataPassDesc_${pass}`)}
										</span>
									</label>
								</div>
							))}
						</div>

						{gamedataPlan.duplicates.some((d) => d.differsFromSurvivor) && (
							<p className="flex items-start gap-1.5 text-xs text-[var(--admin-text-muted)]">
								<AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
								{t("gamedataDifferingWarning")}
							</p>
						)}
						{gamedataPlan.crossSection.length > 0 && (
							<p className="text-xs text-[var(--admin-text-muted)]">
								{t("gamedataCrossSectionNote", {
									count: gamedataPlan.crossSection.length,
								})}
							</p>
						)}
						{gamedataPlan.warnings.map((warning) => (
							<p
								key={warning}
								className="flex items-start gap-1.5 text-xs text-[var(--admin-text-muted)]"
							>
								<AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
								{warning}
							</p>
						))}

						<div className="flex flex-wrap items-center gap-2 rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2">
							<label
								htmlFor="gamedata-max-removals"
								className="flex items-center gap-1.5 text-xs text-[var(--admin-text-muted)]"
							>
								{t("gamedataMaxRemovalsLabel")}
							</label>
							<Input
								id="gamedata-max-removals"
								type="number"
								min={0}
								className="w-24"
								value={gamedataMaxRemovals}
								disabled={busy}
								onChange={(e) => setGamedataMaxRemovals(Number(e.target.value))}
								aria-label={t("gamedataMaxRemovalsLabel")}
							/>
							<span className="text-xs text-[var(--admin-text-muted)]">
								{t("gamedataMaxRemovalsHint")}
							</span>
						</div>

						{gamedataLimitError && (
							<div className="space-y-2 rounded border border-[var(--admin-error)]/40 bg-[var(--admin-error)]/5 p-2 text-xs">
								<p className="font-medium text-[var(--admin-error)]">
									{t("gamedataLimitTitle", {
										pass: gamedataLimitError.pass,
										wouldRemove: gamedataLimitError.wouldRemove,
										maxRemovals: gamedataLimitError.maxRemovals,
									})}
								</p>
								<p className="text-[var(--admin-text-muted)]">
									{t("gamedataLimitDescription")}
								</p>
								<Button
									size="sm"
									variant="outline"
									disabled={busy}
									onClick={() => {
										runGamedataCleanup(
											Math.max(gamedataLimitError.wouldRemove, 1),
										);
									}}
								>
									{t("gamedataLimitOverride", {
										wouldRemove: gamedataLimitError.wouldRemove,
									})}
								</Button>
							</div>
						)}
					</>
				)}
			</div>

			{scan && (
				<div className="space-y-4">
					<div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
						<div className="flex items-center gap-2 text-sm text-[var(--admin-text-muted)]">
							<ScrollText size={15} className="shrink-0" />
							<span>{t("onlyOldLabel")}</span>
						</div>
						<Input
							type="number"
							min={0}
							className="w-20"
							value={minAgeDays}
							disabled={busy || running}
							onChange={(e) => changeMinAgeDays(Number(e.target.value))}
							aria-label={t("onlyOldAgeLabel")}
						/>
						<span className="text-xs text-[var(--admin-text-muted)]">
							{t("daysLabel")}
						</span>
						<label
							htmlFor="nitro-hide-recent"
							className="flex items-center gap-1.5 text-sm"
						>
							<Checkbox
								id="nitro-hide-recent"
								checked={onlyOld}
								disabled={busy || running}
								onCheckedChange={(value) => toggleOnlyOld(value === true)}
							/>
							<span>{t("onlyOldToggle")}</span>
						</label>
					</div>

					{totalSelected > 0 && (
						<div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-surface)]/95 p-2 shadow-sm backdrop-blur">
							<span className="px-1 text-sm font-medium text-[var(--admin-accent)]">
								{t("selectedCount", { count: totalSelected })}
							</span>
							<Button
								variant="destructive"
								size="sm"
								disabled={busy}
								onClick={removeSelected}
								className="bg-[var(--admin-error)] text-[var(--admin-error-foreground)] hover:bg-[var(--admin-error)]/90"
							>
								{deleting ? (
									<Loader2 className="w-4 h-4 animate-spin mr-2" />
								) : (
									<Trash2 className="w-4 h-4 mr-2" />
								)}
								{deleting
									? t("deleting")
									: t("deleteSelected", { count: totalSelected })}
							</Button>
							{scan.broken.length > 0 &&
								[...selected].some((n) =>
									scan.broken.some((e) => e.fileName === n),
								) && (
									<Button
										size="sm"
										disabled={busy || repairing}
										onClick={repairSelected}
									>
										{repairing ? (
											<Loader2 className="w-4 h-4 animate-spin mr-2" />
										) : (
											<Wrench className="w-4 h-4 mr-2" />
										)}
										{repairing ? t("redownloading") : t("redownloadBroken")}
									</Button>
								)}
						</div>
					)}

					{loading && (
						<div className="flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs text-[var(--admin-text-muted)]">
							<Loader2 className="w-4 h-4 animate-spin shrink-0" />
							{t("loadingResult")}
						</div>
					)}

					<div className="grid gap-3 sm:grid-cols-3">
						<div className="rounded-xl border bg-card p-3 space-y-1">
							<div className="text-xl font-bold">{scan.total}</div>
							<div className="text-xs text-muted-foreground">
								{t("scannedStat")}
								{scan.cached && (
									<span className="text-[var(--admin-accent)]">
										{" "}
										{t("cachedNotice")}
									</span>
								)}
							</div>
						</div>
						<div className="rounded-xl border bg-card p-3 space-y-1">
							<div className="text-xl font-bold text-[var(--admin-text)]">
								{scan.fake.length}
							</div>
							<div className="text-xs text-[var(--admin-text-muted)]">
								{t("fakeStat")}
							</div>
						</div>
						<div className="rounded-xl border bg-card p-3 space-y-1">
							<div className="text-xl font-bold text-[var(--admin-text)]">
								{scan.broken.length}
							</div>
							<div className="text-xs text-[var(--admin-text-muted)]">
								{t("brokenStat")}
							</div>
						</div>
					</div>

					{(
						[
							["fake", selected],
							["broken", selected],
							["orphanedSwf", selectedSwf],
							["orphanedIcon", selectedIcon],
						] as Array<[GroupKey, Set<string>]>
					).map(([key, set]) => {
						const props = groupProps(key);
						const entries =
							key === "fake"
								? scan.fake
								: key === "broken"
									? scan.broken
									: key === "orphanedSwf"
										? scan.orphanedSwf
										: scan.orphanedIcon;
						return (
							<CleanupGroup
								key={key}
								{...props}
								entries={entries}
								selected={set}
								onToggle={toggle(
									key === "fake" || key === "broken"
										? "nitro"
										: key === "orphanedSwf"
											? "swf"
											: "icon",
								)}
								onToggleAll={toggleAll(
									key === "fake" || key === "broken"
										? "nitro"
										: key === "orphanedSwf"
											? "swf"
											: "icon",
								)}
								disabled={key === "broken" && onlyOld}
								emptyLabel={t("groupEmpty")}
								selectedLabel={t("selectedCount")}
								copiesLabel={t("copiesBadge")}
								formatAge={formatAge}
							/>
						);
					})}

					{(scan.fake.length > 0 || scan.broken.length > 0) && (
						<p className="flex items-start gap-1.5 rounded-lg border border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)] p-3 text-xs text-[var(--admin-text-muted)]">
							<AlertTriangle
								size={14}
								className="mt-0.5 shrink-0 text-[var(--admin-warning)]"
							/>
							{t("warningText")}
						</p>
					)}

					<div className="flex items-center gap-1.5 text-xs text-[var(--admin-text-muted)]">
						<FileX2 size={14} className="shrink-0" />
						{t("onlyAssetsTouched")}
					</div>
				</div>
			)}

			{!scan && !session && !running && !loading && (
				<div className="rounded-xl border bg-card p-6 text-center text-muted-foreground">
					<ScanSearch className="mx-auto mb-3 h-10 w-10 opacity-40" />
					<p>{t("emptyHint")}</p>
				</div>
			)}

			{!scan && session?.state === "done" && !loading && (
				<div className="rounded-xl border bg-card p-6 text-center text-muted-foreground">
					<p>{t("noResult")}</p>
				</div>
			)}

			{!scan && session?.state === "error" && !loading && (
				<div className="rounded-xl border bg-card p-6 text-center text-muted-foreground">
					<p>{t("scanFailed")}</p>
					{session.error && (
						<p className="mt-2 font-mono text-xs text-[var(--admin-error)]">
							{session.error}
						</p>
					)}
				</div>
			)}

			{history.length > 0 && (
				<section className="space-y-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
					<button
						type="button"
						onClick={() => setShowHistory((v) => !v)}
						className="flex w-full items-center gap-2 text-left text-sm font-medium text-[var(--admin-text)]"
					>
						<Clock
							size={14}
							className="shrink-0 text-[var(--admin-text-muted)]"
						/>
						{t("historyTitle")} ({history.length})
						<span className="ml-auto text-xs text-[var(--admin-text-muted)]">
							{showHistory ? "—" : "+"}
						</span>
					</button>
					{showHistory && (
						<ul className="space-y-1.5">
							{history.map((entry) => (
								<li
									key={`${entry.triggeredAt}-${entry.triggeredBy}-${entry.deleted}-${entry.copiesRemoved}`}
									className="flex flex-wrap items-center gap-2 text-xs text-[var(--admin-text-muted)]"
								>
									<span
										className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${
											entry.triggeredBy === "scheduled"
												? "bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]"
												: "bg-[var(--admin-border)]/60"
										}`}
									>
										{entry.triggeredBy === "scheduled"
											? t("historyScheduled")
											: t("historyManual")}
									</span>
									<span className="shrink-0">
										{new Date(entry.triggeredAt).toLocaleString()}
									</span>
									<span>
										{t("historyEntry", {
											deleted: entry.deleted,
											copies: entry.copiesRemoved,
											recent: entry.skippedRecent,
											broken: entry.skippedBroken,
										})}
									</span>
									{entry.errors.length > 0 && (
										<span className="text-[var(--admin-error)]">
											{t("historyErrors", { count: entry.errors.length })}
										</span>
									)}
								</li>
							))}
						</ul>
					)}
				</section>
			)}
		</div>
	);
}
