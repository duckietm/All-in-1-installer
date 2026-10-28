"use client";

import { Loader2, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createBcItem, deleteBcItem, updateBcItem } from "@/actions/catalog-bc";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useLatestRequest } from "@/features/catalog/client/use-latest-request";
import { useServerAction } from "@/hooks/use-server-action";

interface BcItem {
	id: number;
	pageId: number;
	itemIds: string;
	catalogName: string;
	orderNumber: number;
	extradata: string;
}

interface BcItemsEditorProps {
	pageId: number;
	canEdit: boolean;
}

export function BcItemsEditor({ pageId, canEdit }: BcItemsEditorProps) {
	const { confirm, dialog: confirmDialog } = useConfirmDialog();
	const requests = useLatestRequest();
	const [items, setItems] = useState<BcItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(false);
	const [editingItem, setEditingItem] = useState<BcItem | null>(null);
	const [addingItem, setAddingItem] = useState(false);

	const load = useCallback(async () => {
		const request = requests.start();
		setError(false);
		setLoading(true);
		try {
			const res = await fetch(
				`/api/admin/catalog/items?pageId=${pageId}&catalog=bc`,
				{ signal: request.signal },
			);
			if (!res.ok) throw new Error();
			const data = await res.json();
			if (!request.isCurrent()) return;
			setItems(Array.isArray(data.items) ? data.items : []);
		} catch {
			if (!request.isCurrent()) return;
			setError(true);
		} finally {
			if (request.isCurrent()) setLoading(false);
		}
	}, [pageId, requests]);

	useEffect(() => {
		if (pageId > 0) void load();
		return () => requests.cancel();
	}, [pageId, load, requests]);

	return (
		<div className="space-y-3">
			{confirmDialog}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2 text-sm font-medium">
					<Package className="h-4 w-4 text-muted-foreground" />
					BC Items ({items.length})
				</div>
				{canEdit && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-7 text-xs"
						onClick={() => setAddingItem(true)}
					>
						<Plus className="h-3 w-3 mr-1" />
						Add Item
					</Button>
				)}
			</div>

			{loading ? (
				<div className="flex items-center justify-center py-12">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			) : error ? (
				<div className="flex items-center justify-center py-12">
					<Button variant="outline" size="sm" onClick={() => void load()}>
						Retry
					</Button>
				</div>
			) : items.length === 0 ? (
				<p className="text-sm text-muted-foreground text-center py-8 rounded-md border border-dashed">
					No items in this page.
				</p>
			) : (
				<div className="rounded-md border overflow-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="text-xs w-16">ID</TableHead>
								<TableHead className="text-xs">Name</TableHead>
								<TableHead className="text-xs">Item IDs</TableHead>
								<TableHead className="text-xs w-20">Order</TableHead>
								<TableHead className="text-xs">Extra Data</TableHead>
								{canEdit && (
									<TableHead className="text-xs w-20">Actions</TableHead>
								)}
							</TableRow>
						</TableHeader>
						<TableBody>
							{items.map((item) => (
								<TableRow key={item.id}>
									<TableCell className="text-xs font-mono">{item.id}</TableCell>
									<TableCell className="text-xs font-medium">
										{item.catalogName}
									</TableCell>
									<TableCell className="text-xs font-mono text-muted-foreground">
										{item.itemIds}
									</TableCell>
									<TableCell className="text-xs">{item.orderNumber}</TableCell>
									<TableCell className="text-xs text-muted-foreground max-w-32 truncate">
										{item.extradata || "\u2014"}
									</TableCell>
									{canEdit && (
										<TableCell>
											<div className="flex gap-1">
												<Button
													type="button"
													variant="ghost"
													size="sm"
													className="h-6 w-6 p-0"
													onClick={() => setEditingItem(item)}
												>
													<Pencil className="h-3 w-3" />
												</Button>
												<Button
													type="button"
													variant="ghost"
													size="sm"
													className="h-6 w-6 p-0 text-[var(--admin-error)] hover:text-[var(--admin-error)]"
													onClick={async () => {
														const ok = await confirm({
															title: "Delete BC item",
															description: `Delete item "${item.catalogName}"?`,
															confirmLabel: "Delete",
														});
														if (!ok) return;
														const result = await deleteBcItem({
															id: item.id,
														});
														if (result.ok) {
															setItems((prev) =>
																prev.filter((i) => i.id !== item.id),
															);
														}
													}}
												>
													<Trash2 className="h-3 w-3" />
												</Button>
											</div>
										</TableCell>
									)}
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			{editingItem && (
				<BcItemDialog
					item={editingItem}
					mode="edit"
					onClose={() => setEditingItem(null)}
					onSubmit={async (data) => {
						const result = await updateBcItem({ id: editingItem.id, ...data });
						if (result.ok) {
							setItems((prev) =>
								prev.map((i) =>
									i.id === editingItem.id ? { ...i, ...data } : i,
								),
							);
						}
						return result;
					}}
				/>
			)}

			{addingItem && (
				<BcItemDialog
					item={{
						id: 0,
						pageId,
						itemIds: "",
						catalogName: "",
						orderNumber: 1,
						extradata: "",
					}}
					mode="add"
					onClose={() => setAddingItem(false)}
					onSubmit={async (data) => {
						const result = await createBcItem({ pageId, ...data });
						if (result.ok) await load();
						return result;
					}}
				/>
			)}
		</div>
	);
}

function BcItemDialog({
	item,
	mode,
	onClose,
	onSubmit,
}: {
	item: BcItem;
	mode: "add" | "edit";
	onClose: () => void;
	onSubmit: (data: {
		itemIds: string;
		catalogName: string;
		orderNumber: number;
		extradata: string;
	}) => Promise<{ ok: boolean; error?: string }>;
}) {
	const { run, isPending } = useServerAction();
	const [form, setForm] = useState({
		itemIds: item.itemIds,
		catalogName: item.catalogName,
		orderNumber: item.orderNumber,
		extradata: item.extradata,
	});

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{mode === "add" ? "Add BC Item" : `Edit Item #${item.id}`}
					</DialogTitle>
				</DialogHeader>
				<div className="space-y-4 py-2">
					<div className="space-y-2">
						<Label>Catalog Name</Label>
						<Input
							value={form.catalogName}
							onChange={(e) =>
								setForm((f) => ({ ...f, catalogName: e.target.value }))
							}
						/>
					</div>
					<div className="space-y-2">
						<Label>Item IDs (semicolon-separated)</Label>
						<Input
							value={form.itemIds}
							onChange={(e) =>
								setForm((f) => ({ ...f, itemIds: e.target.value }))
							}
						/>
					</div>
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label>Order</Label>
							<Input
								type="number"
								value={form.orderNumber}
								onChange={(e) =>
									setForm((f) => ({
										...f,
										orderNumber: parseInt(e.target.value, 10) || 0,
									}))
								}
							/>
						</div>
						<div className="space-y-2">
							<Label>Extra Data</Label>
							<Input
								value={form.extradata}
								onChange={(e) =>
									setForm((f) => ({ ...f, extradata: e.target.value }))
								}
								placeholder="Optional"
							/>
						</div>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={isPending}>
						Cancel
					</Button>
					<Button
						onClick={() => {
							run(() => onSubmit(form), {
								successMessage:
									mode === "add" ? "Item created." : "Item updated.",
								errorMessage: "Failed to save.",
								onSuccess: () => onClose(),
							});
						}}
						disabled={isPending || !form.catalogName || !form.itemIds}
					>
						{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						{mode === "add" ? "Add Item" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
