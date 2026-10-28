"use client";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
	applyCatalogDuplicate,
	catalogDuplicateDestinations,
	previewCatalogDuplicate,
} from "@/actions/catalog-duplicate";
import { MovePageCombobox } from "@/components/admin/catalog/catalog-items-table/field-helpers";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { DuplicateInput, DuplicatePreview } from "../domain/duplicate";
export function DuplicateCategoryDialog({
	source,
	onClose,
	onComplete,
}: {
	source: DuplicateInput;
	onClose: () => void;
	onComplete: (id: number) => void;
}) {
	const t = useTranslations("pages.admin.catalog.workspace.duplicate");
	const [name, setName] = useState(source.name);
	const [parentId, setParentId] = useState<number | null>(
		source.parentId <= 0 ? -1 : source.parentId,
	);
	const nameId = useId();
	const [destinations, setDestinations] = useState<
		{ id: number; caption: string }[]
	>([]);
	const [loading, setLoading] = useState(true);
	useEffect(() => {
		let current = true;
		void catalogDuplicateDestinations(source.kind)
			.then((result) => {
				if (!current) return;
				if (result.ok) setDestinations(result.data);
				else toast.error(result.error);
			})
			.catch(() => {
				if (current) toast.error(t("failed"));
			})
			.finally(() => {
				if (current) setLoading(false);
			});
		return () => {
			current = false;
		};
	}, [source.kind, t]);
	const [preview, setPreview] = useState<DuplicatePreview | null>(null);
	const [busy, setBusy] = useState(false);
	const pending = useRef(false);
	async function run() {
		if (pending.current) return;
		pending.current = true;
		setBusy(true);
		try {
			if (!preview) {
				const result = await previewCatalogDuplicate({
					...source,
					name,
					parentId: parentId ?? -1,
				});
				if (!result.ok) throw Error(result.error);
				setPreview(result.data);
			} else {
				const result = await applyCatalogDuplicate(preview);
				if (!result.ok) {
					setPreview(null);
					throw Error(result.error);
				}
				if (result.data.hotel.sent) toast.success(t("saved"));
				else toast.warning(t("savedPending"));
				onComplete(result.data.id);
				onClose();
			}
		} catch (error) {
			setPreview(null);
			toast.error(error instanceof Error ? error.message : t("failed"));
		} finally {
			pending.current = false;
			setBusy(false);
		}
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending.current) onClose();
			}}
		>
			<DialogContent
				className="max-w-lg"
				style={{
					backgroundColor: "var(--admin-surface)",
					color: "var(--admin-text)",
				}}
			>
				<DialogHeader>
					<DialogTitle>{t("title")}</DialogTitle>
					<DialogDescription>{t("description")}</DialogDescription>
				</DialogHeader>
				<label htmlFor={nameId} className="grid gap-1 text-sm">
					{t("name")}
					<Input
						id={nameId}
						value={name}
						maxLength={128}
						disabled={busy}
						onChange={(e) => {
							setName(e.target.value);
							setPreview(null);
						}}
					/>
				</label>
				<div className="grid gap-1 text-sm">
					<p>{t("destination")}</p>
					<MovePageCombobox
						value={parentId}
						onChange={(id) => {
							setParentId(id);
							setPreview(null);
						}}
						pages={[{ id: -1, caption: t("root") }, ...destinations]}
						currentPageId={-2}
						disabled={busy || loading}
						labels={{
							placeholder: t("destination"),
							search: t("search"),
							empty: t("empty"),
							suggested: t("suggested"),
							all: t("all"),
						}}
					/>
				</div>
				<p className="text-sm text-muted-foreground">{t("disabled")}</p>
				{preview && (
					<div
						className="rounded-md border p-3 text-sm space-y-1"
						role="status"
					>
						<p>
							{t("counts", { pages: preview.pages, offers: preview.offers })}
						</p>
						<p>
							{t("summary", {
								name: preview.name,
								destination: preview.destination,
							})}
						</p>
					</div>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="outline" disabled={busy} onClick={onClose}>
						{t("cancel")}
					</Button>
					<Button
						disabled={busy || !name.trim() || parentId === null || loading}
						onClick={() => void run()}
					>
						{busy ? t("working") : preview ? t("confirm") : t("preview")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
