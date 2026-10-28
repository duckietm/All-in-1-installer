"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteMedia, uploadMedia } from "@/actions/admin-media";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { logger } from "@/lib/browser-log";
import { formatDate } from "@/lib/format-date";
import type { MediaFile } from "@/lib/media-files";
import { loadMediaFiles, validImageUrl } from "@/lib/media-files";

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extOf(name: string): string {
	const i = name.lastIndexOf(".");
	return i >= 0 ? name.slice(i + 1).toUpperCase() : "";
}

export function AdminMediaGrid() {
	const t = useTranslations("pages.admin.media");
	const { confirm, dialog: confirmDialog } = useConfirmDialog();
	const [files, setFiles] = useState<MediaFile[]>([]);
	const [loading, setLoading] = useState(true);
	const [uploading, setUploading] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [progress, setProgress] = useState({ current: 0, total: 0 });
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const copyTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

	const load = useCallback(async () => {
		setLoading(true);
		setFiles(await loadMediaFiles());
		setLoading(false);
	}, []);

	useEffect(() => {
		return () => {
			for (const t of copyTimers.current) clearTimeout(t);
			copyTimers.current.clear();
		};
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return files;
		return files.filter((f) => f.name.toLowerCase().includes(q));
	}, [files, query]);

	async function handleUpload(fileList: FileList | File[]) {
		const items = Array.from(fileList);
		if (items.length === 0) return;
		setUploading(true);
		setError(null);
		setProgress({ current: 0, total: items.length });

		await Promise.all(
			items.map(async (file) => {
				const fd = new FormData();
				fd.set("file", file);
				try {
					const res = await uploadMedia(fd);
					if (!res.ok && res.error) setError(res.error);
				} catch (err) {
					setError(err instanceof Error ? err.message : "Upload failed");
				}
				setProgress((prev) => ({ ...prev, current: prev.current + 1 }));
			}),
		);

		await load();
		setUploading(false);
		setProgress({ current: 0, total: 0 });
		if (fileRef.current) fileRef.current.value = "";
	}

	function copyUrl(url: string) {
		navigator.clipboard
			.writeText(window.location.origin + url)
			.then(() => {
				setCopied(url);
				setTimeout(() => setCopied(null), 1500);
			})
			.catch((error) =>
				logger.error("[Media] Clipboard copy failed", {
					err: error as Error,
				}),
			);
	}

	async function remove(name: string) {
		const ok = await confirm({
			title: t("delete"),
			description: t("confirmDelete"),
			confirmLabel: t("delete"),
			variant: "danger",
		});
		if (!ok) return;
		try {
			await deleteMedia(name);
			setFiles((prev) => prev.filter((f) => f.name !== name));
			if (selected === name) setSelected(null);
		} catch {
			/* ignore */
		}
	}

	return (
		<div className="admin-card">
			{confirmDialog}
			{/* Toolbar */}
			<div className="flex flex-wrap items-center gap-3 mb-4">
				<label className="btn btn-primary cursor-pointer text-sm">
					{uploading ? t("uploading") : t("upload")}
					<input
						ref={fileRef}
						type="file"
						accept="image/png,image/jpeg,image/gif,image/webp"
						onChange={(e) => handleUpload(e.target.files ?? [])}
						multiple
						className="hidden"
					/>
				</label>

				<input
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={t("searchPlaceholder")}
					className="input input-bordered flex-1 min-w-[180px] text-sm"
				/>

				<span className="text-xs theme-text-muted dark:theme-text-muted whitespace-nowrap">
					{filtered.length} / {files.length}
				</span>
			</div>

			{uploading && (
				<div className="mb-4">
					<div className="flex justify-between text-xs mb-1">
						<span>{t("uploading")}</span>
						<span>
							{progress.current} / {progress.total}
						</span>
					</div>
					<div className="h-2 w-full bg-[var(--admin-accent)]/10 rounded-full overflow-hidden">
						<div
							className="h-full bg-gradient-to-r from-[var(--admin-accent)] to-[var(--admin-accent)] transition-all duration-300"
							style={{ width: `${(progress.current / progress.total) * 100}%` }}
						/>
					</div>
				</div>
			)}

			{error && (
				<p className="text-xs text-[var(--admin-error)] mb-3">{error}</p>
			)}

			{/* Dropzone */}
			<button
				type="button"
				aria-label={t("uploadSubtitle")}
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(e) => {
					e.preventDefault();
					setDragging(false);
					if (e.dataTransfer.files?.length) handleUpload(e.dataTransfer.files);
				}}
				className="rounded-xl border-2 border-dashed mb-4 text-center py-6 transition-colors duration-150"
				style={{
					borderColor: dragging
						? "var(--admin-accent)"
						: "color-mix(in srgb, var(--admin-text-muted) 25%, transparent)",
					background: dragging
						? "color-mix(in srgb, var(--admin-accent) 8%, transparent)"
						: "transparent",
				}}
			>
				<p className="text-xs theme-text-muted dark:theme-text-muted m-0">
					{t("uploadSubtitle")}
				</p>
			</button>

			{loading ? (
				<p className="text-xs theme-text-muted dark:theme-text-muted text-center py-10">
					{t("uploading")}
				</p>
			) : files.length === 0 ? (
				<p className="text-xs theme-text-muted dark:theme-text-muted text-center py-10">
					{t("noFiles")}
				</p>
			) : filtered.length === 0 ? (
				<p className="text-xs theme-text-muted dark:theme-text-muted text-center py-10">
					{t("noFiles")}
				</p>
			) : (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
					{filtered.map((f) => {
						const isSelected = selected === f.name;
						return (
							// biome-ignore lint/a11y/useSemanticElements: grid tile uses role=button for selection
							<div
								key={f.name}
								role="button"
								tabIndex={0}
								aria-label={f.name}
								onClick={() => setSelected(f.name)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										setSelected(f.name);
									}
								}}
								className="group border rounded-[12px] overflow-hidden bg-[var(--admin-canvas)] cursor-pointer transition-all duration-150"
								style={{
									borderColor: isSelected
										? "var(--admin-accent)"
										: "color-mix(in srgb, var(--admin-text-muted) 14%, transparent)",
								}}
							>
								<div className="relative">
									<img
										src={validImageUrl(f.url)}
										alt={f.name}
										loading="lazy"
										className="w-full h-[120px] object-cover block"
									/>
									<span className="absolute top-1.5 right-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/55 text-background uppercase">
										{extOf(f.name)}
									</span>
								</div>
								<div className="p-2">
									<p className="text-xs m-0 mb-0.5 overflow-hidden text-ellipsis whitespace-nowrap font-medium">
										{f.name}
									</p>
									<p className="text-[11px] m-0 text-[var(--admin-text-muted)]">
										{formatSize(f.size)} ·{" "}
										{formatDate(new Date(f.uploaded), "date")}
									</p>
									<div className="flex gap-1.5 mt-2">
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												copyUrl(f.url);
											}}
											className="btn btn-outline text-[11px] py-1 flex-1"
										>
											{copied === f.url ? t("urlCopied") : t("copyUrl")}
										</button>
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												remove(f.name);
											}}
											className="btn text-[11px] py-1 px-2 text-[var(--admin-error)]"
										>
											{t("delete")}
										</button>
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
