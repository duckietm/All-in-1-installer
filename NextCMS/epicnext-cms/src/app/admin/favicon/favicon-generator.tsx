"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const SIZE = 64;
const HALF = SIZE / 2;

interface Props {
	onSave: (blob: Blob) => void;
}

export function FaviconGenerator({ onSave }: Props) {
	const t = useTranslations("pages.admin.favicon.generator");
	const [bgColor, setBgColor] = useState("#6366f1");
	const [textColor, setTextColor] = useState("#ffffff");
	const [text, setText] = useState("A");
	const [rounded, setRounded] = useState(true);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	const render = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		canvas.width = SIZE;
		canvas.height = SIZE;

		// Background
		ctx.clearRect(0, 0, SIZE, SIZE);
		ctx.fillStyle = bgColor;
		if (rounded) {
			const r = 12;
			ctx.beginPath();
			ctx.moveTo(r, 0);
			ctx.lineTo(SIZE - r, 0);
			ctx.quadraticCurveTo(SIZE, 0, SIZE, r);
			ctx.lineTo(SIZE, SIZE - r);
			ctx.quadraticCurveTo(SIZE, SIZE, SIZE - r, SIZE);
			ctx.lineTo(r, SIZE);
			ctx.quadraticCurveTo(0, SIZE, 0, SIZE - r);
			ctx.lineTo(0, r);
			ctx.quadraticCurveTo(0, 0, r, 0);
			ctx.closePath();
			ctx.fill();
		} else {
			ctx.fillRect(0, 0, SIZE, SIZE);
		}

		// Text
		const displayText = text.trim() || "?";
		const fontSize =
			displayText.length > 2 ? 28 : displayText.length > 1 ? 32 : 40;
		ctx.fillStyle = textColor;
		ctx.font = `bold ${fontSize}px Arial, sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(displayText, HALF, HALF + 1);
	}, [bgColor, textColor, text, rounded]);

	useEffect(() => {
		render();
	}, [render]);

	function handleSave() {
		const canvas = canvasRef.current;
		if (!canvas) return;
		canvas.toBlob((blob) => {
			if (blob) onSave(blob);
		}, "image/png");
	}

	const swatches = [
		"#6366f1",
		"#3b82f6",
		"#06b6d4",
		"#10b981",
		"#f59e0b",
		"#ef4444",
		"#ec4899",
		"#8b5cf6",
		"#1e1b4b",
		"#1f2937",
		"#000000",
		"#ffffff",
	];

	return (
		<div className="admin-card">
			<h3 className="text-sm font-extrabold text-[var(--admin-text)] mb-4">
				{t("title")}
			</h3>

			<div className="flex justify-center mb-6">
				<canvas
					ref={canvasRef}
					width={SIZE}
					height={SIZE}
					className="border-2 border-[var(--admin-border)] rounded-xl shadow-lg"
					style={{ width: 128, height: 128, imageRendering: "pixelated" }}
				/>
			</div>

			<div className="space-y-4">
				<div>
					<label
						htmlFor="favicon-text"
						className="block text-xs font-bold text-[var(--admin-text-muted)] uppercase tracking-wider mb-2"
					>
						{t("text")}
					</label>
					<input
						id="favicon-text"
						type="text"
						value={text}
						onChange={(e) => setText(e.target.value.slice(0, 4))}
						maxLength={4}
						className="w-full"
						placeholder="A"
					/>
				</div>

				<div>
					<label
						htmlFor="favicon-bgColor"
						className="block text-xs font-bold text-[var(--admin-text-muted)] uppercase tracking-wider mb-2"
					>
						{t("bgColor")}
					</label>
					<div className="flex items-center gap-2 mb-2">
						<input
							id="favicon-bgColor"
							type="color"
							value={bgColor}
							onChange={(e) => setBgColor(e.target.value)}
							className="w-10 h-10 rounded-lg cursor-pointer border border-[var(--admin-border)]"
						/>
						<span className="text-xs text-[var(--admin-text-muted)] font-mono">
							{bgColor}
						</span>
					</div>
					<div className="flex flex-wrap gap-1.5">
						{swatches.map((c) => (
							<button
								key={c}
								type="button"
								onClick={() => setBgColor(c)}
								className={`w-7 h-7 rounded-lg border-2 transition-all ${
									bgColor === c
										? "border-[var(--admin-accent)] scale-110"
										: "border-transparent"
								}`}
								style={{ backgroundColor: c }}
							/>
						))}
					</div>
				</div>

				<div>
					<label
						htmlFor="favicon-textColor"
						className="block text-xs font-bold text-[var(--admin-text-muted)] uppercase tracking-wider mb-2"
					>
						{t("textColor")}
					</label>
					<div className="flex items-center gap-2">
						<input
							id="favicon-textColor"
							type="color"
							value={textColor}
							onChange={(e) => setTextColor(e.target.value)}
							className="w-10 h-10 rounded-lg cursor-pointer border border-[var(--admin-border)]"
						/>
						<span className="text-xs text-[var(--admin-text-muted)] font-mono">
							{textColor}
						</span>
					</div>
				</div>

				<div className="flex items-center gap-2">
					<input
						type="checkbox"
						id="rounded"
						checked={rounded}
						onChange={(e) => setRounded(e.target.checked)}
						className="rounded"
					/>
					<label
						htmlFor="rounded"
						className="text-sm text-[var(--admin-text)] cursor-pointer"
					>
						{t("rounded")}
					</label>
				</div>

				<Button
					type="button"
					onClick={handleSave}
					variant="default"
					className="w-full"
				>
					{t("save")}
				</Button>
			</div>
		</div>
	);
}
