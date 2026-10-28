"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadMediaAndReturn } from "@/actions/admin-media";
import type { MediaFile } from "@/lib/media-files";
import { loadMediaFiles, validImageUrl } from "@/lib/media-files";

export function MediaPicker({
	onSelect,
	current,
}: {
	onSelect: (url: string) => void;
	current?: string;
}) {
	const [open, setOpen] = useState(false);
	const [files, setFiles] = useState<MediaFile[]>([]);
	const [loading, setLoading] = useState(false);
	const [uploading, setUploading] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setFiles(await loadMediaFiles());
		setLoading(false);
	}, []);

	useEffect(() => {
		if (open) load();
	}, [open, load]);

	async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
		const files = e.target.files;
		if (!files || files.length === 0) return;
		setUploading(true);
		const urls: string[] = [];
		for (const file of Array.from(files)) {
			const fd = new FormData();
			fd.set("file", file);
			const url = await uploadMediaAndReturn(fd);
			if (url) urls.push(url);
		}
		if (urls.length > 0) {
			await load();
			onSelect(urls[urls.length - 1]); // select the last one for backward compatibility
			setOpen(false);
		}
		setUploading(false);
		if (fileRef.current) fileRef.current.value = "";
	}

	return (
		<>
			<div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="btn btn-outline"
					style={{ fontSize: "0.82rem", padding: "0.3rem 0.7rem" }}
				>
					Browse
				</button>
				{current && (
					<span
						style={{
							fontSize: "0.78rem",
							color: "var(--admin-text-muted)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							maxWidth: 200,
						}}
					>
						{current.split("/").pop()}
					</span>
				)}
			</div>

			{open && (
				// biome-ignore lint/a11y/useSemanticElements: backdrop overlay uses role=button for click-to-close
				<div
					role="button"
					tabIndex={0}
					aria-label="Close media picker"
					className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50"
					onClick={(e) => {
						if (e.target === e.currentTarget) setOpen(false);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							setOpen(false);
						}
					}}
				>
					<div
						role="dialog"
						aria-modal="true"
						className="bg-[var(--admin-surface)] text-[var(--admin-text)] rounded-2xl w-[min(90vw,680px)] max-h-[80vh] flex flex-col shadow-xl"
					>
						<div className="flex items-center justify-between px-4 py-3 border-b border-[var(--admin-text-muted)]/14">
							<strong className="text-base">Media Library</strong>
							<div className="flex gap-2 items-center">
								<label className="btn btn-primary text-sm cursor-pointer">
									{uploading ? "Uploading…" : "Upload"}
									<input
										ref={fileRef}
										type="file"
										accept="image/png,image/jpeg,image/gif,image/webp"
										onChange={handleUpload}
										className="hidden"
										multiple
									/>
								</label>
								<button
									type="button"
									onClick={() => setOpen(false)}
									className="btn text-sm"
								>
									Close
								</button>
							</div>
						</div>
						<div className="flex-1 overflow-auto p-3">
							{loading ? (
								<p className="text-xs text-[var(--admin-text-muted)] text-center py-8">
									Loading…
								</p>
							) : files.length === 0 ? (
								<p className="text-xs text-[var(--admin-text-muted)] text-center py-8">
									No images yet. Upload one above.
								</p>
							) : (
								<div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
									{files.map((f) => (
										<button
											type="button"
											key={f.name}
											onClick={() => {
												onSelect(f.url);
												setOpen(false);
											}}
											className="border-2 border-transparent rounded-xl overflow-hidden cursor-pointer bg-[var(--admin-canvas)] p-0 flex flex-col transition-all duration-150"
											style={{
												borderColor:
													f.url === current
														? "var(--admin-accent)"
														: "transparent",
											}}
											onMouseEnter={(e) => {
												if (f.url !== current)
													e.currentTarget.style.borderColor =
														"color-mix(in srgb, var(--admin-accent) 40%, transparent)";
											}}
											onMouseLeave={(e) => {
												if (f.url !== current)
													e.currentTarget.style.borderColor = "transparent";
											}}
										>
											<img
												src={validImageUrl(f.url)}
												alt={f.name}
												className="w-full h-[100px] object-cover block"
											/>
											<span className="text-xs py-1 text-center overflow-hidden text-ellipsis whitespace-nowrap">
												{f.name}
											</span>
										</button>
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			)}
		</>
	);
}
