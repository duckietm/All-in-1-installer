"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { updateRoomItem } from "@/actions/rooms";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";

interface EditItem {
	id: number;
	name: string;
	type: string;
	x: number;
	y: number;
	z: number;
	rot: number;
	wallPos: string;
	extraData: string;
}

interface Props {
	roomId: number;
	item: EditItem | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function EditItemDialog({ roomId, item, open, onOpenChange }: Props) {
	const { run, isPending } = useServerAction();
	const [x, setX] = useState("0");
	const [y, setY] = useState("0");
	const [z, setZ] = useState("0");
	const [rot, setRot] = useState("0");
	const [wallPos, setWallPos] = useState("");
	const [extraData, setExtraData] = useState("");

	const isWall = item?.type === "i";
	const tAction = useTranslations("pages.admin.actions");
	const dirty =
		!!item &&
		(extraData !== item.extraData ||
			(isWall
				? wallPos !== item.wallPos
				: x !== String(item.x) ||
					y !== String(item.y) ||
					z !== String(item.z) ||
					rot !== String(item.rot)));
	const { confirmLeave, markSaved } = useUnsavedChanges(
		open && dirty,
		tAction("leaveUnsaved"),
	);
	function requestOpenChange(next: boolean) {
		if (next || (!isPending && confirmLeave())) onOpenChange(next);
	}

	useEffect(() => {
		if (item && open) {
			setX(String(item.x));
			setY(String(item.y));
			setZ(String(item.z));
			setRot(String(item.rot));
			setWallPos(item.wallPos);
			setExtraData(item.extraData);
		}
	}, [item, open]);

	function handleSave() {
		if (!item) return;
		const payload = isWall
			? { roomId, itemId: item.id, wallPos, extraData }
			: {
					roomId,
					itemId: item.id,
					x: Number(x),
					y: Number(y),
					z: Number(z),
					rot: Number(rot),
					extraData,
				};
		run(() => updateRoomItem(payload), {
			successMessage: "Item updated and room reloaded",
			onSuccess: () => {
				markSaved();
				onOpenChange(false);
			},
		});
	}

	return (
		<Dialog open={open} onOpenChange={requestOpenChange}>
			<DialogContent className="sm:max-w-[480px]">
				<DialogHeader>
					<DialogTitle>Edit furniture</DialogTitle>
					<DialogDescription>
						{item ? `${item.name} (#${item.id})` : ""}
					</DialogDescription>
				</DialogHeader>

				<fieldset disabled={isPending} className="space-y-4">
					{isWall ? (
						<div className="space-y-2">
							<Label htmlFor="wallPos">Wall position</Label>
							<Input
								id="wallPos"
								value={wallPos}
								onChange={(e) => setWallPos(e.target.value)}
								placeholder=":w=0,0 l=0,0 r"
								className="font-mono"
							/>
							<p className="text-xs text-muted-foreground">
								Format: <code>:w=X,Y l=X,Y r</code>
							</p>
						</div>
					) : (
						<>
							<div className="grid grid-cols-3 gap-3">
								<div className="space-y-2">
									<Label htmlFor="x">X</Label>
									<Input
										id="x"
										type="number"
										value={x}
										onChange={(e) => setX(e.target.value)}
										className="font-mono"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="y">Y</Label>
									<Input
										id="y"
										type="number"
										value={y}
										onChange={(e) => setY(e.target.value)}
										className="font-mono"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="z">Z</Label>
									<Input
										id="z"
										type="number"
										step="0.01"
										value={z}
										onChange={(e) => setZ(e.target.value)}
										className="font-mono"
									/>
								</div>
							</div>
							<div className="space-y-2">
								<Label htmlFor="rot">Rotation (0-7)</Label>
								<Input
									id="rot"
									type="number"
									min={0}
									max={7}
									value={rot}
									onChange={(e) => setRot(e.target.value)}
									className="font-mono w-24"
								/>
							</div>
						</>
					)}

					<div className="space-y-2">
						<Label htmlFor="extraData">Extra data</Label>
						<Textarea
							id="extraData"
							value={extraData}
							onChange={(e) => setExtraData(e.target.value)}
							rows={3}
							className="font-mono text-xs"
							placeholder="(empty)"
						/>
						<p className="text-xs text-muted-foreground">
							Item state/data (e.g. dice value, sticky note text, color)
						</p>
					</div>
				</fieldset>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => requestOpenChange(false)}
						disabled={isPending}
					>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={isPending}>
						{isPending ? "Saving..." : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
