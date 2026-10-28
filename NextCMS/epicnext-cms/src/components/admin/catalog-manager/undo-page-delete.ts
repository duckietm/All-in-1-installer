import { toast } from "sonner";
import { createCatalogPage } from "@/actions/catalog";
import { createBcPage } from "@/actions/catalog-bc";
import type { CatalogManagerMode } from "./use-catalog-store";

export interface DeletedPageSnapshot {
	caption: string;
	parentId: number;
	pageLayout?: string;
	iconImage?: number;
	iconColor?: number;
	enabled?: string;
	visible?: string;
	minRank?: number;
	orderNum?: number;
}

/**
 * Re-creates a page that was just deleted, preserving its placement and
 * presentation fields. Item rows and text content cannot be restored (they
 * were already removed server-side), but editing intent survives.
 */
export async function restoreDeletedPage(
	catalogType: CatalogManagerMode,
	snapshot: DeletedPageSnapshot,
): Promise<number | null> {
	try {
		const input = {
			parentId: snapshot.parentId ?? -1,
			caption: snapshot.caption,
			pageLayout: snapshot.pageLayout ?? "default_3x3",
			iconImage: snapshot.iconImage ?? 0,
			iconColor: snapshot.iconColor ?? 0,
			enabled: (snapshot.enabled ?? "1") as "0" | "1",
			visible: (snapshot.visible ?? "1") as "0" | "1",
			orderNum: snapshot.orderNum ?? 0,
		};
		const result =
			catalogType === "bc"
				? await createBcPage(input)
				: await createCatalogPage(
						catalogType === "normal"
							? { ...input, minRank: snapshot.minRank ?? 1 }
							: input,
					);
		if (!result.ok) throw new Error(result.error);
		return Number(result.data?.id) || null;
	} catch {
		return null;
	}
}

/** Success toast that doubles as the undo trigger for a page deletion. */
export function showUndoableDeleteToast(
	message: string,
	onUndo: () => void | Promise<void>,
) {
	toast.success(message, {
		action: {
			label: "Undo",
			onClick: () => void onUndo(),
		},
	});
}
