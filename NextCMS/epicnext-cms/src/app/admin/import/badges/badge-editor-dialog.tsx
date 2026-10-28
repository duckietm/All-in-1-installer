"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getBadgeData, updateBadge } from "@/actions/badges";
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
import { useServerAction } from "@/hooks/use-server-action";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";

interface BadgeEditorDialogProps {
	code: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Called after a successful save so the parent can refresh state */
	onSaved?: () => void;
}

export function BadgeEditorDialog({
	code,
	open,
	onOpenChange,
	onSaved,
}: BadgeEditorDialogProps) {
	const [name, setName] = useState("");
	const [desc, setDesc] = useState("");
	const [loading, setLoading] = useState(false);
	const { run, isPending: saving } = useServerAction();
	const [saved, setSaved] = useState({ name: "", desc: "" });
	const tAction = useTranslations("pages.admin.actions");
	const { confirmLeave, markSaved } = useUnsavedChanges(
		open && !loading && (name !== saved.name || desc !== saved.desc),
		tAction("leaveUnsaved"),
	);
	function requestOpenChange(next: boolean) {
		if (next || (!saving && confirmLeave())) onOpenChange(next);
	}

	// Fetch current values when dialog opens
	useEffect(() => {
		if (!open || !code) return;
		let active = true;
		setLoading(true);
		getBadgeData({ code })
			.then((result) => {
				if (active && result.ok) {
					const data = result.data as { name: string; desc: string };
					setName(data.name ?? "");
					setDesc(data.desc ?? "");
					setSaved({ name: data.name ?? "", desc: data.desc ?? "" });
				}
			})
			.catch(() => {
				if (active) toast.error("Failed to load badge data");
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [open, code]);

	function handleSave() {
		run(() => updateBadge({ code, name, desc }), {
			successMessage: `Badge ${code} updated`,
			errorMessage: "Save failed",
			onSuccess: () => {
				markSaved();
				setSaved({ name, desc });
				onSaved?.();
				onOpenChange(false);
			},
		});
	}

	return (
		<Dialog open={open} onOpenChange={requestOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						Edit Badge — {code}
					</DialogTitle>
				</DialogHeader>

				{loading ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
					</div>
				) : (
					<fieldset disabled={saving} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="badge-name">Name</Label>
							<Input
								id="badge-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Badge name"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="badge-desc">Description</Label>
							<Input
								id="badge-desc"
								value={desc}
								onChange={(e) => setDesc(e.target.value)}
								placeholder="Badge description"
							/>
						</div>
					</fieldset>
				)}

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => requestOpenChange(false)}
						disabled={saving}
					>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={loading || saving}>
						{saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
