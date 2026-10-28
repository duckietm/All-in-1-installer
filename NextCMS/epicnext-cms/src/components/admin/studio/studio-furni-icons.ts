import type { SyntheticEvent } from "react";

import type { FurniItem } from "./studio-types";

export function getFurniImageUrl(item: FurniItem) {
	if (item.iconUrl) return item.iconUrl;
	const iconName = item.classname.replace(/\*/g, "_");
	return `/swf/dcr/hof_furni/icons/${encodeURIComponent(iconName)}_icon.png`;
}

export function handleImgError(
	e: SyntheticEvent<HTMLImageElement>,
	item: FurniItem,
) {
	const img = e.target as HTMLImageElement;
	const iconName = item.classname.replace(/\*/g, "_");
	if (!img.dataset.fallback) {
		img.dataset.fallback = "1";
		img.src = `/swf/dcr/hof_furni/icons/${encodeURIComponent(iconName)}_icon.png`;
	} else if (img.dataset.fallback === "1") {
		img.dataset.fallback = "2";
		img.src =
			'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="%2399a0aa" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
	} else {
		img.src =
			'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="%2399a0aa" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
	}
}

export const TYPE_LABELS: Record<string, string> = {
	flooritem: "Floor",
	wallitem: "Wall",
};
