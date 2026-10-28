"use client";

import { useState } from "react";
import { contrastRatio, readableColor } from "@/lib/theme-contrast";

type ColorFieldProps = {
	name: string;
	label: string;
	description: string;
	defaultValue: string;
	/** Background color to check the foreground contrast against. */
	bgValue?: string;
};

export function ColorField({
	name,
	label,
	description,
	defaultValue,
	bgValue,
}: ColorFieldProps) {
	const [val, setVal] = useState(defaultValue);
	const ratio = bgValue ? contrastRatio(val, bgValue) : null;
	const poor = ratio != null && ratio < 4.5;
	const ok = ratio != null && ratio >= 4.5;

	return (
		<div
			style={{
				display: "flex",
				gap: "0.6rem",
				padding: "0.5rem",
				borderRadius: 8,
				border: poor ? "1px solid #ef4444" : "1px solid transparent",
				background: poor ? "rgba(239,68,68,0.08)" : "transparent",
			}}
		>
			<input
				type="color"
				name={name}
				value={val}
				onChange={(e) => {
					const next = e.target.value;
					if (bgValue) {
						const nextRatio = contrastRatio(next, bgValue);
						if (nextRatio != null && nextRatio < 4.5) {
							setVal(readableColor("#ffffff", [bgValue]));
							return;
						}
					}
					setVal(next);
				}}
				style={{
					width: 42,
					height: 36,
					padding: 0,
					border: "none",
					background: "none",
					cursor: "pointer",
					flexShrink: 0,
				}}
			/>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					minWidth: 0,
					flex: 1,
				}}
			>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "baseline",
						gap: "0.5rem",
					}}
				>
					<span
						style={{ fontSize: "0.82rem", fontWeight: 600, lineHeight: 1.2 }}
					>
						{label}
					</span>
					{ratio != null ? (
						<span
							style={{
								fontSize: "0.7rem",
								fontWeight: 700,
								color: ok ? "#22c55e" : "#ef4444",
								whiteSpace: "nowrap",
							}}
						>
							{ratio.toFixed(1)}:1 {ok ? "✓" : "⚠"}
						</span>
					) : null}
				</div>
				<span
					style={{
						fontSize: "0.7rem",
						color: "var(--admin-text-muted)",
						lineHeight: 1.3,
						display: "-webkit-box",
						WebkitLineClamp: 2,
						WebkitBoxOrient: "vertical",
						overflow: "hidden",
					}}
				>
					{description}
				</span>
				{bgValue ? (
					<div
						style={{
							marginTop: 4,
							padding: "2px 8px",
							borderRadius: 4,
							background: bgValue,
							color: val,
							fontSize: "0.75rem",
							fontWeight: 600,
						}}
					>
						Aa Text preview
					</div>
				) : null}
				{poor && bgValue ? (
					<button
						type="button"
						onClick={() => setVal(readableColor("#ffffff", [bgValue]))}
						style={{
							marginTop: 4,
							alignSelf: "flex-start",
							fontSize: "0.7rem",
							fontWeight: 600,
							color: "var(--admin-accent)",
							background: "none",
							border: "none",
							padding: 0,
							cursor: "pointer",
						}}
					>
						Use readable color →
					</button>
				) : null}
			</div>
		</div>
	);
}
