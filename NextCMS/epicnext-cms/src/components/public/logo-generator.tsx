"use client";

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useTransition,
} from "react";
import { saveLogo } from "@/actions/save-logo";
import { HABBO_FONT_GROUPS } from "@/components/public/habbo-fonts";
import {
	getFontInfo,
	getMissingChars,
	renderToCanvas,
} from "@/components/public/sprite-font";
import { ContentCard } from "@/components/public/ui";

export default function LogoGenerator({
	initialText = "",
	canSaveToSite = false,
}: {
	initialText?: string;
	canSaveToSite?: boolean;
}) {
	const [text, setText] = useState(initialText);
	const [styleName, setStyleName] = useState("habbo");
	const [search, setSearch] = useState("");
	const [saveStatus, setSaveStatus] = useState<
		"idle" | "saving" | "done" | "error"
	>("idle");
	const [fontLoaded, setFontLoaded] = useState(false);
	const [fontError, setFontError] = useState(false);
	const [missingChars, setMissingChars] = useState<Set<string>>(new Set());
	const [, startTransition] = useTransition();
	const canvasRef = useRef<HTMLCanvasElement>(null);

	const safeText = text.trim() || "Your hotel";

	const currentFont = useMemo(
		() =>
			HABBO_FONT_GROUPS.flatMap((g) => g.fonts).find(
				(f) => f.styleName === styleName,
			),
		[styleName],
	);

	const filteredGroups = useMemo(
		() =>
			search
				? HABBO_FONT_GROUPS.map((g) => ({
						...g,
						fonts: g.fonts.filter(
							(f) =>
								f.name.toLowerCase().includes(search.toLowerCase()) ||
								f.styleName.toLowerCase().includes(search.toLowerCase()),
						),
					})).filter((g) => g.fonts.length > 0)
				: HABBO_FONT_GROUPS,
		[search],
	);

	// Load font and render preview
	useEffect(() => {
		let cancelled = false;

		getFontInfo(styleName)
			.then((info) => {
				if (cancelled) return;
				const canvas = renderToCanvas(
					info.chars,
					info.h,
					info.top,
					info.sheet,
					safeText,
					info.avgW,
				);
				if (canvas && canvasRef.current) {
					canvasRef.current.width = canvas.width;
					canvasRef.current.height = canvas.height;
					const ctx = canvasRef.current.getContext("2d");
					ctx?.drawImage(canvas, 0, 0);
				}
				setMissingChars(getMissingChars(info.chars, safeText));
				setFontLoaded(true);
			})
			.catch(() => {
				if (!cancelled) setFontError(true);
			});

		return () => {
			cancelled = true;
		};
	}, [styleName, safeText]);

	const handleDownload = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		canvas.toBlob((blob) => {
			if (!blob) return;
			const a = document.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = `${safeText.replace(/[^a-z0-9]+/gi, "_") || "logo"}.png`;
			a.click();
			URL.revokeObjectURL(a.href);
		}, "image/png");
	}, [safeText]);

	const handleSave = useCallback(() => {
		if (!canSaveToSite) return;
		const canvas = canvasRef.current;
		if (!canvas) return;
		setSaveStatus("saving");
		canvas.toBlob((blob) => {
			if (!blob) {
				setSaveStatus("error");
				return;
			}
			const file = new File([blob], "logo.png", { type: "image/png" });
			const fd = new FormData();
			fd.append("file", file);
			startTransition(async () => {
				const result = await saveLogo(fd);
				setSaveStatus(result.success ? "done" : "error");
				setTimeout(() => setSaveStatus("idle"), 3000);
			});
		}, "image/png");
	}, [canSaveToSite]);

	const [zipping, setZipping] = useState(false);
	const allFonts = useMemo(() => HABBO_FONT_GROUPS.flatMap((g) => g.fonts), []);

	const handleDownloadAll = useCallback(async () => {
		if (zipping) return;
		setZipping(true);
		try {
			const JSZip = (await import("jszip")).default;
			const zip = new JSZip();
			const folder = zip.folder(
				safeText.replace(/[^a-z0-9]+/gi, "_") || "logo",
			);
			if (!folder) throw new Error("Failed to create zip folder");
			let fail = 0;

			for (const font of allFonts) {
				try {
					const info = await getFontInfo(font.styleName);
					const canvas = renderToCanvas(
						info.chars,
						info.h,
						info.top,
						info.sheet,
						safeText,
						info.avgW,
					);
					if (!canvas) {
						fail++;
						continue;
					}
					const blob = await new Promise<Blob | null>((r) =>
						canvas.toBlob((b) => r(b), "image/png"),
					);
					if (blob) folder.file(`${font.styleName}.png`, blob);
					else fail++;
				} catch {
					fail++;
				}
			}

			const content = await zip.generateAsync({ type: "blob" });
			const a = document.createElement("a");
			a.href = URL.createObjectURL(content);
			a.download = `${safeText.replace(/[^a-z0-9]+/gi, "_") || "logo"}-all-fonts.zip`;
			a.click();
			URL.revokeObjectURL(a.href);
			if (fail > 0)
				alert(
					`${allFonts.length - fail}/${allFonts.length} fonts (${fail} failed)`,
				);
		} catch {
			alert("Failed to create ZIP.");
		} finally {
			setZipping(false);
		}
	}, [safeText, allFonts, zipping]);

	return (
		<div className="card-grid md-2" style={{ alignItems: "start" }}>
			<ContentCard
				icon="⚙️"
				title="Design"
				subtitle="Pick a Habbo font and type your text."
			>
				<div style={{ display: "grid", gap: "1rem" }}>
					<label style={{ display: "grid", gap: "0.3rem" }}>
						<span style={{ fontWeight: 700, fontSize: "0.85rem" }}>
							Hotel name
						</span>
						<input
							type="text"
							value={text}
							onChange={(e) => setText(e.target.value)}
							placeholder="Your hotel"
							maxLength={40}
						/>
					</label>

					<label style={{ display: "grid", gap: "0.3rem" }}>
						<span style={{ fontWeight: 700, fontSize: "0.85rem" }}>
							Search font
						</span>
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Type to filter fonts…"
						/>
					</label>

					<label style={{ display: "grid", gap: "0.3rem" }}>
						<span style={{ fontWeight: 700, fontSize: "0.85rem" }}>
							Font —{" "}
							<span className="muted">
								{currentFont?.name ?? styleName} ({styleName})
							</span>
						</span>
						<select
							value={styleName}
							onChange={(e) => setStyleName(e.target.value)}
							style={{ maxHeight: 320 }}
							size={Math.min(
								filteredGroups.flatMap((g) => g.fonts).length +
									filteredGroups.length,
								12,
							)}
						>
							{filteredGroups.map((group) => (
								<optgroup key={group.groupName} label={group.groupName}>
									{group.fonts.map((f) => (
										<option key={f.styleName} value={f.styleName}>
											{f.name}
										</option>
									))}
								</optgroup>
							))}
						</select>
					</label>

					<button
						type="button"
						className="btn btn-primary"
						onClick={handleDownload}
						disabled={!fontLoaded}
					>
						⬇️ Download PNG
					</button>
					{canSaveToSite && (
						<button
							type="button"
							className="btn btn-primary"
							onClick={handleSave}
							disabled={saveStatus === "saving" || !fontLoaded}
						>
							{saveStatus === "saving"
								? "⏳ Saving..."
								: saveStatus === "done"
									? "✅ Saved!"
									: saveStatus === "error"
										? "❌ Error"
										: "💾 Save as site logo"}
						</button>
					)}
					<button
						type="button"
						className="btn btn-secondary"
						onClick={handleDownloadAll}
						disabled={zipping}
					>
						{zipping ? "⏳ Creating ZIP..." : "📦 Download all fonts"}
					</button>
				</div>
			</ContentCard>

			<ContentCard
				icon="👁️"
				title="Preview"
				subtitle="Rendered locally from sprite sheets."
			>
				<div
					style={{
						display: "grid",
						placeItems: "center",
						minHeight: 220,
						padding: "1.25rem",
						borderRadius: "12px",
						border:
							"1px dashed color-mix(in srgb, var(--color-text-muted) 30%, transparent)",
						overflow: "auto",
						background:
							"repeating-conic-gradient(color-mix(in srgb, var(--color-text-muted) 14%, transparent) 0% 25%, transparent 0% 50%) 50% / 22px 22px",
					}}
				>
					{fontError ? (
						<p className="muted">Failed to load font sprite.</p>
					) : fontLoaded ? (
						<>
							<canvas
								ref={canvasRef}
								style={{ maxWidth: "100%", height: "auto" }}
							/>
							{missingChars.size > 0 && (
								<p
									className="muted"
									style={{ marginTop: 8, fontSize: "0.8rem" }}
								>
									Note: this font does not have characters:{" "}
									{[...missingChars].join(", ")}
								</p>
							)}
						</>
					) : (
						<p className="muted">Loading font…</p>
					)}
				</div>
			</ContentCard>
		</div>
	);
}
