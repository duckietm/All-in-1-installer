"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { updateItemsBase } from "@/actions/items-base";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerAction } from "@/hooks/use-server-action";

export type ItemsBaseEditValues = {
	id: number;
	spriteId: number;
	publicName: string;
	itemName: string;
	type: string;
	width: number;
	length: number;
	stackHeight: string;
	allowStack: number;
	allowSit: number;
	allowLay: number;
	allowWalk: number;
	allowGift: number;
	allowTrade: number;
	allowRecycle: number;
	allowMarketplaceSell: number;
	allowInventoryStack: number;
	interactionType: string;
	interactionModesCount: number;
	vendingIds: string;
	multiheight: string;
	customparams: string;
};

const ALLOW_FLAGS: Array<{ key: keyof ItemsBaseEditValues; label: string }> = [
	{ key: "allowStack", label: "Stack" },
	{ key: "allowSit", label: "Sit" },
	{ key: "allowLay", label: "Lay" },
	{ key: "allowWalk", label: "Walk" },
	{ key: "allowGift", label: "Gift" },
	{ key: "allowTrade", label: "Trade" },
	{ key: "allowRecycle", label: "Recycle" },
	{ key: "allowMarketplaceSell", label: "Marketplace" },
	{ key: "allowInventoryStack", label: "Inv. stack" },
];

export function ItemsBaseEditForm({
	initial,
	canEdit,
}: {
	initial: ItemsBaseEditValues;
	canEdit: boolean;
}) {
	const t = useTranslations("pages.admin.items");
	const router = useRouter();
	const { run, isPending } = useServerAction();
	const [form, setForm] = useState(initial);

	function setField<K extends keyof ItemsBaseEditValues>(
		key: K,
		value: ItemsBaseEditValues[K],
	) {
		setForm((prev) => ({ ...prev, [key]: value }));
	}

	function handleSave() {
		if (!canEdit || isPending) return;
		const { id, ...fields } = form;
		run(() => updateItemsBase({ id, fields }), {
			successMessage: t("saved"),
			onSuccess: () => router.refresh(),
		});
	}

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p className="text-sm text-muted-foreground m-0 font-mono">
						#{form.id}
					</p>
					<h2 className="text-xl font-bold m-0">
						{form.publicName || form.itemName || t("untitled")}
					</h2>
				</div>
				<div className="flex gap-2">
					<Button variant="outline" asChild>
						<Link href="/admin/items">{t("back")}</Link>
					</Button>
					{canEdit ? (
						<Button onClick={handleSave} disabled={isPending}>
							{t("save")}
						</Button>
					) : null}
				</div>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm">{t("sectionIdentity")}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div>
							<Label htmlFor="publicName">{t("publicName")}</Label>
							<Input
								id="publicName"
								value={form.publicName}
								disabled={!canEdit}
								onChange={(e) => setField("publicName", e.target.value)}
							/>
						</div>
						<div>
							<Label htmlFor="itemName">{t("itemName")}</Label>
							<Input
								id="itemName"
								value={form.itemName}
								disabled={!canEdit}
								className="font-mono"
								onChange={(e) => setField("itemName", e.target.value)}
							/>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div>
								<Label htmlFor="type">{t("type")}</Label>
								<Input
									id="type"
									value={form.type}
									disabled={!canEdit}
									maxLength={3}
									onChange={(e) => setField("type", e.target.value)}
								/>
							</div>
							<div>
								<Label htmlFor="spriteId">{t("spriteId")}</Label>
								<Input
									id="spriteId"
									type="number"
									value={form.spriteId}
									disabled={!canEdit}
									onChange={(e) => setField("spriteId", Number(e.target.value))}
								/>
							</div>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm">{t("sectionDims")}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="grid grid-cols-3 gap-3">
							<div>
								<Label htmlFor="width">{t("width")}</Label>
								<Input
									id="width"
									type="number"
									value={form.width}
									disabled={!canEdit}
									onChange={(e) => setField("width", Number(e.target.value))}
								/>
							</div>
							<div>
								<Label htmlFor="length">{t("length")}</Label>
								<Input
									id="length"
									type="number"
									value={form.length}
									disabled={!canEdit}
									onChange={(e) => setField("length", Number(e.target.value))}
								/>
							</div>
							<div>
								<Label htmlFor="stackHeight">{t("stackHeight")}</Label>
								<Input
									id="stackHeight"
									value={form.stackHeight}
									disabled={!canEdit}
									onChange={(e) => setField("stackHeight", e.target.value)}
								/>
							</div>
						</div>
						<div>
							<Label htmlFor="interactionType">{t("interactionType")}</Label>
							<Input
								id="interactionType"
								value={form.interactionType}
								disabled={!canEdit}
								onChange={(e) => setField("interactionType", e.target.value)}
							/>
						</div>
						<div>
							<Label htmlFor="interactionModesCount">
								{t("interactionModes")}
							</Label>
							<Input
								id="interactionModesCount"
								type="number"
								value={form.interactionModesCount}
								disabled={!canEdit}
								onChange={(e) =>
									setField("interactionModesCount", Number(e.target.value))
								}
							/>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm">{t("sectionFlags")}</CardTitle>
					</CardHeader>
					<CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3">
						{ALLOW_FLAGS.map(({ key, label }) => (
							<label
								key={key}
								className="flex items-center gap-2 text-sm rounded-md border px-2 py-1.5"
							>
								<input
									type="checkbox"
									checked={Number(form[key]) === 1}
									disabled={!canEdit}
									onChange={(e) => setField(key, e.target.checked ? 1 : 0)}
								/>
								{label}
							</label>
						))}
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm">{t("sectionExtra")}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div>
							<Label htmlFor="vendingIds">{t("vendingIds")}</Label>
							<Input
								id="vendingIds"
								value={form.vendingIds}
								disabled={!canEdit}
								onChange={(e) => setField("vendingIds", e.target.value)}
							/>
						</div>
						<div>
							<Label htmlFor="multiheight">{t("multiheight")}</Label>
							<Input
								id="multiheight"
								value={form.multiheight}
								disabled={!canEdit}
								onChange={(e) => setField("multiheight", e.target.value)}
							/>
						</div>
						<div>
							<Label htmlFor="customparams">{t("customparams")}</Label>
							<Input
								id="customparams"
								value={form.customparams}
								disabled={!canEdit}
								onChange={(e) => setField("customparams", e.target.value)}
							/>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
