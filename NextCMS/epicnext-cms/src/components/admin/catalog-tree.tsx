"use client";

import { Package } from "lucide-react";
import { useState } from "react";
import { catalogueIconUrl } from "@/lib/catalog-assets";

/* ─── Catalog Icon ───────────────────────────────────────── */

export function CatalogIcon({
	iconImage,
	size = 20,
}: {
	iconImage: number;
	size?: number;
}) {
	const [error, setError] = useState(0);

	// A few icons ship only as `.gif`; retry once before giving up.
	if (error >= 2 || iconImage <= 0) {
		return <Package className="h-4 w-4 text-muted-foreground shrink-0" />;
	}

	return (
		<img
			src={catalogueIconUrl(iconImage, error === 0 ? "png" : "gif")}
			alt=""
			width={size}
			height={size}
			className="shrink-0 object-contain"
			style={{ imageRendering: "pixelated", minWidth: size, minHeight: size }}
			onError={() => setError((e) => e + 1)}
		/>
	);
}

/* ─── Layout label helper ────────────────────────────────── */

export const LAYOUT_COLORS: Record<string, string> = {
	default_3x3:
		"bg-[var(--admin-info-subtle)] text-[var(--admin-info)] dark:text-[var(--admin-info)]",
	frontpage:
		"bg-[var(--admin-warning-subtle)] text-[var(--admin-warning)] dark:text-[var(--admin-warning)]",
	spaces_new:
		"bg-[var(--admin-success-subtle)] text-[var(--admin-success)] dark:text-[var(--admin-success)]",
	pets: "bg-[var(--admin-error)]/15 text-[var(--admin-error)]",
	pets2: "bg-[var(--admin-error)]/15 text-[var(--admin-error)]",
	pets3: "bg-[var(--admin-error)]/15 text-[var(--admin-error)]",
	marketplace: "bg-[var(--admin-accent)]/15 text-[var(--admin-accent-text)]",
	recycler:
		"bg-[var(--admin-success-subtle)] text-[var(--admin-success)] dark:text-[var(--admin-success)]",
	club_buy:
		"bg-[var(--admin-warning-subtle)] text-[var(--admin-warning)] dark:text-[var(--admin-warning)]",
	single_bundle:
		"bg-[var(--admin-info-subtle)] text-[var(--admin-info)] dark:text-[var(--admin-info)]",
	room_bundle:
		"bg-[var(--admin-warning-subtle)] text-[var(--admin-warning)] dark:text-[var(--admin-warning)]",
};
