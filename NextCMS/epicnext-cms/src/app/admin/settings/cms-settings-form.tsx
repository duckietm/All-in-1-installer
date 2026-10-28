"use client";

import {
	Building2,
	Gamepad2,
	ImageIcon,
	Link as LinkIcon,
	Loader2,
	Music,
	Save,
	Shield,
	UserPlus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { saveManagedSettings } from "@/actions/admin-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import {
	BOOLEAN_KEYS,
	type ManagedField,
	SETTINGS_GROUPS,
	type SettingsGroup,
} from "./cms-settings-config";

const ICONS = {
	building: Building2,
	image: ImageIcon,
	gamepad: Gamepad2,
	music: Music,
	shield: Shield,
	link: LinkIcon,
	"user-plus": UserPlus,
} as const;

export function CmsSettingsForm({
	values: initialValues,
	canEdit,
}: {
	values: Record<string, string>;
	canEdit: boolean;
}) {
	const [values, setValues] = useState(initialValues);
	const [savedValues, setSavedValues] = useState(initialValues);
	const tAction = useTranslations("pages.admin.actions");
	const dirty = Object.keys({ ...savedValues, ...values }).some(
		(key) => savedValues[key] !== values[key],
	);
	useUnsavedChanges(canEdit && dirty, tAction("leaveUnsaved"));
	const { isPending, run, fieldErrors } = useServerAction();
	const t = useTranslations("pages.admin.settings");

	function handleChange(key: string, value: string) {
		setValues((prev) => ({ ...prev, [key]: value }));
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!canEdit) return;
		const submitted = { ...values };
		const normalized = { ...values };
		for (const key of BOOLEAN_KEYS) {
			normalized[key] = values[key] === "1" ? "1" : "0";
		}
		run(() => saveManagedSettings({ settings: normalized }), {
			successMessage: t("saved"),
			errorMessage: t("saveFailed"),
			onSuccess: () => setSavedValues(submitted),
		});
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-5">
			{Object.keys(fieldErrors).length > 0 && (
				<div role="alert" className="admin-card text-sm text-destructive">
					{Object.values(fieldErrors).flat().join(" · ")}
				</div>
			)}
			{SETTINGS_GROUPS.map((group) => (
				<GroupSection
					key={group.id}
					group={group}
					values={values}
					canEdit={canEdit && !isPending}
					onChange={handleChange}
				/>
			))}

			{canEdit ? (
				<div className="sticky bottom-3 z-10 flex justify-end">
					<Button
						type="submit"
						disabled={isPending || !dirty}
						className="shadow-lg"
					>
						{isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Save className="mr-2 h-4 w-4" />
						)}
						{isPending ? t("form.saving") : t("saveSettings")}
					</Button>
				</div>
			) : (
				<p className="text-sm text-muted-foreground">{t("viewOnly")}</p>
			)}
		</form>
	);
}

function GroupSection({
	group,
	values,
	canEdit,
	onChange,
}: {
	group: SettingsGroup;
	values: Record<string, string>;
	canEdit: boolean;
	onChange: (key: string, value: string) => void;
}) {
	const Icon = ICONS[group.icon];
	return (
		<section className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 space-y-4 shadow-card">
			<div className="flex items-start gap-3">
				<div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--admin-accent)]/20 to-[var(--admin-accent)]/5 grid place-items-center shrink-0">
					<Icon size={18} className="text-[var(--admin-accent)]" />
				</div>
				<div className="min-w-0">
					<h2 className="m-0 text-base font-bold text-[var(--admin-text)]">
						{group.title}
					</h2>
					{group.description ? (
						<p className="m-0 mt-0.5 text-xs text-[var(--admin-text-muted)]">
							{group.description}
						</p>
					) : null}
				</div>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				{group.fields.map((field) => (
					<FieldControl
						key={field.key}
						field={field}
						value={values[field.key] ?? ""}
						canEdit={canEdit}
						onChange={onChange}
					/>
				))}
			</div>
		</section>
	);
}

function FieldControl({
	field,
	value,
	canEdit,
	onChange,
}: {
	field: ManagedField;
	value: string;
	canEdit: boolean;
	onChange: (key: string, value: string) => void;
}) {
	const type = field.type ?? "text";
	const wide = type === "textarea" || type === "boolean";

	if (type === "boolean") {
		const checked = value === "1" || value.toLowerCase() === "true";
		return (
			<div
				className={`${wide ? "sm:col-span-2" : ""} flex items-center justify-between gap-4 rounded-xl border border-[var(--admin-border)] px-4 py-3`}
			>
				<div className="min-w-0">
					<Label htmlFor={field.key} className="text-sm font-semibold">
						{field.label}
					</Label>
					{field.description ? (
						<p className="m-0 mt-0.5 text-xs text-muted-foreground">
							{field.description}
						</p>
					) : null}
				</div>
				<Switch
					id={field.key}
					checked={checked}
					disabled={!canEdit}
					onCheckedChange={(next) => onChange(field.key, next ? "1" : "0")}
				/>
			</div>
		);
	}

	return (
		<div className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
			<Label htmlFor={field.key} className="text-sm font-semibold">
				{field.label}
			</Label>
			{field.description ? (
				<p className="m-0 text-xs text-muted-foreground">{field.description}</p>
			) : null}
			{type === "textarea" ? (
				<Textarea
					id={field.key}
					value={value}
					disabled={!canEdit}
					placeholder={field.placeholder}
					onChange={(e) => onChange(field.key, e.target.value)}
					rows={3}
				/>
			) : type === "select" ? (
				<select
					id={field.key}
					value={value}
					disabled={!canEdit}
					onChange={(e) => onChange(field.key, e.target.value)}
					className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
				>
					{(field.options ?? []).map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</select>
			) : (
				<Input
					id={field.key}
					type={
						type === "number"
							? "number"
							: type === "password"
								? "password"
								: "text"
					}
					value={value}
					disabled={!canEdit}
					placeholder={field.placeholder}
					onChange={(e) => onChange(field.key, e.target.value)}
				/>
			)}
			<code className="block text-[0.65rem] text-muted-foreground truncate">
				{field.key}
			</code>
		</div>
	);
}
