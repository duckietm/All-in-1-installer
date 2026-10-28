"use client";

import { ImageOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CATALOGUE_ASSET_BASE_PATH } from "@/lib/catalog-assets";

interface ImagePreviewProps {
	value: string;
	basePath?: string;
	height?: number;
	className?: string;
}

export function ImagePreview({
	value,
	basePath = CATALOGUE_ASSET_BASE_PATH,
	height = 60,
	className,
}: ImagePreviewProps) {
	const [src, setSrc] = useState("");
	const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">(
		"idle",
	);
	const [fallback, setFallback] = useState(false);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!value.trim()) {
			setSrc("");
			setStatus("idle");
			setFallback(false);
			return;
		}

		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			setFallback(false);
			const url = `${basePath}/${value.trim()}.png`;
			setSrc(url);
			setStatus("loading");
		}, 300);

		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [value, basePath]);

	function handleError() {
		if (!fallback) {
			// Try .gif as fallback
			setFallback(true);
			setSrc(`${basePath}/${value.trim()}.gif`);
			setStatus("loading");
		} else {
			setStatus("error");
		}
	}

	if (status === "idle" || !src) {
		return (
			<div
				className={`flex items-center justify-center rounded border border-dashed bg-muted/30 text-muted-foreground ${className || ""}`}
				style={{ height }}
			>
				<ImageOff className="h-4 w-4" />
			</div>
		);
	}

	return (
		<div
			className={`relative flex items-center justify-center rounded border bg-muted/30 overflow-hidden ${className || ""}`}
			style={{ height }}
		>
			{status === "loading" && (
				<Loader2 className="h-4 w-4 animate-spin text-muted-foreground absolute" />
			)}
			<img
				src={src}
				alt=""
				className="max-h-full max-w-full object-contain"
				style={{ imageRendering: "pixelated" }}
				onLoad={() => setStatus("loaded")}
				onError={handleError}
			/>
			{status === "error" && (
				<div className="absolute inset-0 flex items-center justify-center bg-muted/60">
					<ImageOff className="h-4 w-4 text-muted-foreground" />
				</div>
			)}
		</div>
	);
}
