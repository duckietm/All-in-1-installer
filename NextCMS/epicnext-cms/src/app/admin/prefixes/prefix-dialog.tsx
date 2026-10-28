"use client";
import { Save, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import {
	PRESET_EFFECTS,
	PRESET_ICONS,
	type PrefixFormData,
	type UserPrefix,
} from "./prefix-model";
export function PrefixDialog({
	isOpen,
	onClose,
	onSave,
	editPrefix,
}: {
	isOpen: boolean;
	onClose: () => void;
	onSave: (data: PrefixFormData, editId?: number) => Promise<boolean>;
	editPrefix: UserPrefix | null;
}) {
	const [form, setForm] = useState<PrefixFormData>({
		username: "",
		text: "",
		color: "#FFFFFF",
		icon: "",
		effect: "",
		active: false,
	});
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const [saveError, setSaveError] = useState(false);
	const tAction = useTranslations("pages.admin.actions");
	const initial: PrefixFormData = {
		username: editPrefix?.username || "",
		text: editPrefix?.text || "",
		color: editPrefix?.color || "#FFFFFF",
		icon: editPrefix?.icon || "",
		effect: editPrefix?.effect || "",
		active: editPrefix?.active ?? false,
	};
	const dirty = Object.keys(initial).some(
		(key) =>
			form[key as keyof PrefixFormData] !==
			initial[key as keyof PrefixFormData],
	);
	const { confirmLeave, markSaved } = useUnsavedChanges(
		isOpen && dirty,
		tAction("leaveUnsaved"),
	);
	function requestClose() {
		if (!saving && confirmLeave()) onClose();
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: isOpen acts as a trigger here, not a value read in the body; removing it is a real regression, reverted once in 704e3363
	useEffect(() => {
		setSaveError(false);
		if (editPrefix) {
			setForm({
				username: editPrefix.username || "",
				text: editPrefix.text,
				color: editPrefix.color,
				icon: editPrefix.icon || "",
				effect: editPrefix.effect || "",
				active: editPrefix.active,
			});
		} else {
			setForm({
				username: "",
				text: "",
				color: "#FFFFFF",
				icon: "",
				effect: "",
				active: false,
			});
		}
		// isOpen must stay in the deps: the effect is what clears the form when
		// the dialog is reopened. Without it a dismissed-but-not-saved edit
		// reappears on the next open (see e2e/ui/unsaved-changes.spec.ts).
	}, [editPrefix, isOpen]);

	if (!isOpen) return null;

	const handleSave = async () => {
		if (savingRef.current) return;
		savingRef.current = true;
		setSaveError(false);
		setSaving(true);
		try {
			if (!(await onSave(form, editPrefix?.id))) {
				setSaveError(true);
				return;
			}
			markSaved();
			onClose();
		} catch {
			setSaveError(true);
		} finally {
			savingRef.current = false;
			setSaving(false);
		}
	};

	// Parse multi-color for preview
	const colors = form.color.split(",");
	const hasMultiColor = colors.length > 1 && new Set(colors).size > 1;

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) requestClose();
			}}
			disablePointerDismissal
		>
			<DialogContent
				showCloseButton={false}
				className="block max-h-[90dvh] overflow-y-auto sm:max-w-md space-y-4"
			>
				<fieldset disabled={saving} className="contents">
					{saveError && <p role="alert">{tAction("saveError")}</p>}
					<div className="flex items-center justify-between">
						<DialogTitle className="text-lg font-semibold">
							{editPrefix ? "Edit Prefix" : "Add Prefix"}
						</DialogTitle>
						<button
							type="button"
							disabled={saving}
							onClick={requestClose}
							className="text-muted-foreground hover:text-foreground"
						>
							<span className="sr-only">Close prefix editor</span>
							<X className="h-5 w-5" />
						</button>
					</div>

					{/* Preview */}
					<div className="flex items-center justify-center p-3 rounded-lg bg-muted min-h-[40px]">
						<span className="text-lg font-bold">
							{form.icon && <span className="mr-0.5">{form.icon}</span>}
							{hasMultiColor ? (
								<span>
									{"{"}
									{[...(form.text || "...")]
										.map((char, i) => ({ char, n: i }))
										.map(({ char, n }) => (
											<span
												key={`char-${n}`}
												style={{
													color: colors[Math.min(n, colors.length - 1)],
												}}
											>
												{char}
											</span>
										))}
									{"}"}
								</span>
							) : (
								<span style={{ color: colors[0] || "#FFFFFF" }}>
									{"{"}
									{form.text || "..."}
									{"}"}
								</span>
							)}
						</span>
						<span className="ml-2 text-lg text-muted-foreground">
							{form.username || "Username"}
						</span>
					</div>

					{!editPrefix && (
						<div className="space-y-2">
							<span className="text-sm font-medium">Username</span>
							<Input
								placeholder="Username..."
								aria-label="Username"
								value={form.username}
								onChange={(e) => setForm({ ...form, username: e.target.value })}
							/>
						</div>
					)}

					<div className="space-y-2">
						<span className="text-sm font-medium">Text</span>
						<Input
							maxLength={15}
							placeholder="Prefix text..."
							aria-label="Prefix text"
							value={form.text}
							onChange={(e) => setForm({ ...form, text: e.target.value })}
						/>
						<span className="text-xs text-muted-foreground">
							{form.text.length}/15
						</span>
					</div>

					<div className="space-y-2">
						<span className="text-sm font-medium">
							Color (HEX or multi: #FF0000,#00FF00)
						</span>
						<div className="flex items-center gap-2">
							<Input
								placeholder="#FFFFFF o #FF0000,#00FF00,..."
								aria-label="Prefix color"
								value={form.color}
								onChange={(e) => setForm({ ...form, color: e.target.value })}
							/>
							<div
								className="w-8 h-8 rounded border shrink-0"
								style={{ backgroundColor: colors[0] || "#FFFFFF" }}
							/>
						</div>
					</div>

					<div className="space-y-2">
						<span className="text-sm font-medium">Icon</span>
						<select
							className="w-full px-3 py-2 rounded border bg-background text-sm"
							aria-label="Prefix icon"
							value={form.icon}
							onChange={(e) => setForm({ ...form, icon: e.target.value })}
						>
							{PRESET_ICONS.map((icon) => (
								<option key={icon.label} value={icon.emoji}>
									{icon.emoji ? `${icon.emoji} ${icon.label}` : icon.label}
								</option>
							))}
						</select>
					</div>

					<div className="space-y-2">
						<span className="text-sm font-medium">Effect</span>
						<select
							className="w-full px-3 py-2 rounded border bg-background text-sm"
							aria-label="Prefix effect"
							value={form.effect}
							onChange={(e) => setForm({ ...form, effect: e.target.value })}
						>
							{PRESET_EFFECTS.map((fx) => (
								<option key={fx.id} value={fx.id}>
									{fx.label}
								</option>
							))}
						</select>
					</div>

					<div className="flex items-center gap-2">
						<input
							checked={form.active}
							id="prefix-active"
							type="checkbox"
							onChange={(e) => setForm({ ...form, active: e.target.checked })}
						/>
						<label className="text-sm" htmlFor="prefix-active">
							Active
						</label>
					</div>

					<div className="flex justify-end gap-2 pt-2">
						<Button variant="outline" onClick={requestClose}>
							Cancel
						</Button>
						<Button
							disabled={
								saving ||
								!form.text.trim() ||
								(!editPrefix && !form.username.trim())
							}
							onClick={handleSave}
						>
							<Save className="h-4 w-4 mr-1" />
							{saving ? "Saving..." : "Save"}
						</Button>
					</div>
				</fieldset>
			</DialogContent>
		</Dialog>
	);
}
