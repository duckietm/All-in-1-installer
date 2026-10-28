"use client";
import {
	Check,
	CloudDownload,
	Loader2,
	Pencil,
	RefreshCw,
	Sparkles,
	Trash2,
	WandSparkles,
	X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { previewAutoCatalog } from "@/lib/furni/auto-catalog";
import { FurnitureInspector } from "./furniture-inspector";
import { getFurniImageUrl, handleImgError } from "./studio-furni-icons";
import type { FurniItem } from "./studio-types";

interface FurnitureDetailDrawerProps {
	detail: FurniItem;
	importingId: string | null;
	regenerating: boolean;
	busy: boolean;
	inspectionKey: string;
	onClose: () => void;
	onImport: () => void;
	onEdit: () => void;
	onDelete: () => void;
	onRegenerate: () => void;
	onRepair: () => Promise<unknown>;
}
export function FurnitureDetailDrawer({
	detail,
	importingId,
	regenerating,
	busy,
	inspectionKey,
	onClose,
	onImport,
	onEdit,
	onDelete,
	onRegenerate,
	onRepair,
}: FurnitureDetailDrawerProps) {
	const t = useTranslations("admin.studio.completeness");
	const studioT = useTranslations("admin.studio");
	const drawerT = useTranslations("admin.studio.drawer");
	const typeLabel =
		detail.type === "wallitem" ? studioT("types.wall") : studioT("types.floor");
	const detailPreview = previewAutoCatalog(
		detail.classname,
		detail.type === "wallitem" ? "i" : "s",
	);
	return (
		<aside className="absolute inset-y-0 right-0 z-20 flex h-full w-[min(28rem,100%)] shrink-0 flex-col border-l border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-xl lg:static lg:h-full lg:shadow-none">
			<div className="flex shrink-0 items-center justify-between border-b border-[var(--admin-border)] px-3 py-2.5">
				<span className="text-xs font-bold uppercase tracking-wider text-[var(--admin-text-muted)]">
					{drawerT("title")}
				</span>
				<button
					type="button"
					aria-label={studioT("aria.closeDetails")}
					onClick={onClose}
					className="rounded-md p-1 text-[var(--admin-text-muted)] hover:bg-[var(--admin-accent)]/10 hover:text-[var(--admin-text)]"
				>
					<X size={14} />
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-4">
				<div
					className="mb-4 grid h-40 place-items-center overflow-hidden rounded-xl border border-[var(--admin-border)]"
					style={{
						backgroundImage:
							"radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--admin-text-muted) 14%, transparent) 1px, transparent 0)",
						backgroundSize: "14px 14px",
					}}
				>
					<img
						src={getFurniImageUrl(detail)}
						alt={detail.name}
						className="h-28 w-28 object-contain"
						style={{ imageRendering: "pixelated" }}
						onError={(e) => handleImgError(e, detail)}
					/>
				</div>

				<h2 className="text-base font-bold leading-tight text-[var(--admin-text)]">
					{detail.name}
				</h2>
				<p className="mb-3 mt-0.5 font-mono text-xs text-[var(--admin-text-muted)]">
					{detail.classname}
				</p>

				{detail.description ? (
					<p className="mb-3 text-xs leading-relaxed text-[var(--admin-text-muted)]">
						{detail.description}
					</p>
				) : null}

				<div className="mb-4 flex flex-wrap gap-1.5">
					<Badge variant="secondary">{typeLabel}</Badge>
					<Badge variant="secondary">
						{drawerT("revision", { revision: detail.revision })}
					</Badge>
					{detail.alreadyImported ? (
						<Badge className="text-[var(--admin-success)] border-[var(--admin-success)]/40">
							<Check size={10} /> {t("parts.sql")}: {t("statuses.present")}
						</Badge>
					) : (
						<Badge className="text-[var(--admin-accent-foreground)]">
							<Sparkles size={10} /> {drawerT("autoImportReady")}
						</Badge>
					)}
				</div>

				<FurnitureInspector
					key={inspectionKey}
					item={detail}
					busy={busy}
					onRepair={onRepair}
				/>
				{/* Auto-catalog preview */}
				{detailPreview && (
					<div className="mb-4 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-canvas)] p-3">
						<div className="mb-2 flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-[var(--admin-text-muted)]">
							<WandSparkles size={12} className="text-[var(--admin-accent)]" />
							{drawerT("automaticPlacement")}
						</div>
						<div className="space-y-2">
							<div className="flex items-center justify-between text-xs">
								<span className="text-[var(--admin-text-muted)]">
									{drawerT("category")}
								</span>
								<span className="font-semibold text-[var(--admin-text)]">
									{detailPreview.categoryLabel}
								</span>
							</div>
							<div className="flex items-center justify-between text-xs">
								<span className="text-[var(--admin-text-muted)]">
									{drawerT("price")}
								</span>
								<span className="font-semibold text-[var(--admin-text)]">
									{detailPreview.points > 0
										? drawerT("priceCreditsPoints", {
												credits: detailPreview.credits,
												points: detailPreview.points,
											})
										: drawerT("priceCredits", {
												count: detailPreview.credits,
											})}
								</span>
							</div>
						</div>
					</div>
				)}
			</div>

			<div className="shrink-0 border-t border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
				<div className="space-y-2">
					{!detail.alreadyImported ? (
						<Button
							className="w-full gap-1.5"
							disabled={importingId !== null}
							onClick={onImport}
						>
							{importingId === detail.classname ? (
								<Loader2 size={14} className="animate-spin" />
							) : (
								<CloudDownload size={14} />
							)}
							{drawerT("importAdd")}
						</Button>
					) : (
						<div className="space-y-2">
							{!detail.nitroExists && (
								<>
									<p className="rounded-md border border-[var(--admin-warning)]/30 bg-[var(--admin-warning)]/10 p-2 text-[0.65rem] text-[var(--admin-warning)]">
										{drawerT("bundleMissing")}
									</p>
									<Button
										variant="outline"
										className="w-full gap-1.5 text-[var(--admin-warning)]"
										disabled={regenerating}
										onClick={onRegenerate}
									>
										{regenerating ? (
											<Loader2 size={14} className="animate-spin" />
										) : (
											<RefreshCw size={14} />
										)}
										{drawerT("regenerate")}
									</Button>
								</>
							)}
							<Button
								variant="secondary"
								className="w-full gap-1.5"
								onClick={onEdit}
								disabled={!detail.nitroExists}
							>
								<Pencil size={14} />
								{drawerT("editNitro")}
							</Button>
						</div>
					)}

					{detail.alreadyImported && (
						<Button
							variant="outline"
							className="w-full gap-1.5 text-[var(--admin-warning)]"
							onClick={onDelete}
						>
							<Trash2 size={14} />
							{drawerT("deleteImported")}
						</Button>
					)}
				</div>
			</div>
		</aside>
	);
}
