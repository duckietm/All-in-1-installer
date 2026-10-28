"use client";

import { Image as ImageIcon } from "lucide-react";
import { getHabboCdnIconUrl, getLocalIconUrl } from "@/lib/furni/classname";

export function FurniIcon({
	classname,
	revision,
}: {
	classname: string;
	revision: number;
}) {
	if (!classname) {
		return (
			<div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
				<ImageIcon className="h-4 w-4 text-muted-foreground" />
			</div>
		);
	}

	const localUrl = getLocalIconUrl(classname);

	function handleError(e: React.SyntheticEvent<HTMLImageElement>) {
		const img = e.target as HTMLImageElement;
		const stage = img.dataset.fallback;
		if (!stage && revision > 0) {
			img.dataset.fallback = "cdn";
			img.src = getHabboCdnIconUrl(classname, revision);
		} else {
			img.dataset.fallback = "none";
			img.style.opacity = "0";
		}
	}

	return (
		<div className="w-10 h-10 rounded bg-muted/50 flex items-center justify-center overflow-hidden">
			<img
				src={localUrl}
				alt={classname}
				className="max-w-full max-h-full object-contain"
				style={{ imageRendering: "pixelated" }}
				onError={handleError}
				loading="lazy"
			/>
		</div>
	);
}
