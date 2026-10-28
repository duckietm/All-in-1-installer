"use client";
import { useState } from "react";

export function ProfileImage({
	src,
	alt,
	width,
	height,
	fallback,
	className,
	loading,
	fetchPriority,
}: {
	src: string;
	alt: string;
	width: number;
	height: number;
	fallback?: string;
	className?: string;
	/** "eager" for the hero image of a page (it *is* the LCP element). */
	loading?: "lazy" | "eager";
	fetchPriority?: "high" | "low" | "auto";
}) {
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	const failed = failedSrc === src;
	if (failed && !fallback)
		return (
			<span
				role="img"
				aria-label={alt}
				className={className}
				style={{
					width,
					height,
					display: "inline-grid",
					placeItems: "center",
					fontSize: "2rem",
					fontWeight: 700,
				}}
			>
				{alt.slice(0, 1).toUpperCase()}
			</span>
		);
	return (
		<img
			src={failed ? fallback : src}
			alt={alt}
			width={width}
			height={height}
			className={className}
			loading={loading ?? "lazy"}
			fetchPriority={fetchPriority}
			decoding="async"
			onError={() => setFailedSrc(src)}
		/>
	);
}
