"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
	applyPresetManager,
	applyTheme,
	clearBackground,
	deleteTheme,
	importTheme,
	renameTheme,
	saveBackground,
	saveCurrentTheme,
	uploadBackground,
} from "@/actions/theme-manager";
import { Button } from "@/components/ui/button";
import {
	BACKGROUND_EFFECTS,
	BACKGROUND_POSITIONS,
	BACKGROUND_REPEATS,
	BACKGROUND_SIZES,
	OVERLAY_OPACITY_MAX,
	OVERLAY_PRESETS,
} from "@/lib/theme-bg";
import type { CustomTheme } from "@/lib/theme-custom-store";
import { serializeThemeExport, swatchColors } from "@/lib/theme-manager-format";
import { PRESETS } from "@/lib/theme-presets";

export type ThemeManagerBackground = {
	image: string;
	position: string;
	size: string;
	repeat: string;
	effect: string;
	overlay: string;
	overlayOpacity: string;
};

interface ThemeManagerPanelProps {
	themes: CustomTheme[];
	current: Record<string, string>;
	background: ThemeManagerBackground;
	activeName: string;
	notice?: string;
}

const PRESET_SWATCH_KEYS = [
	"color_primary",
	"color_accent",
	"color_surface",
	"color_text",
] as const;

function safeFileStem(name: string): string {
	return (name.trim().replace(/[^a-zA-Z0-9-_]+/g, "-") || "theme").slice(0, 60);
}

function downloadJson(name: string, settings: Record<string, string>) {
	const blob = new Blob([serializeThemeExport(name, settings)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${safeFileStem(name)}.atom-theme.json`;
	a.click();
	URL.revokeObjectURL(url);
}

function Swatches({
	settings,
	size = 16,
}: {
	settings: Record<string, string>;
	size?: number;
}) {
	return (
		<div className="flex items-center">
			{swatchColors(settings).map((color) => (
				<span
					key={color}
					style={{
						width: size,
						height: size,
						borderRadius: 4,
						background: color,
						boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)",
						marginLeft: -3,
					}}
				/>
			))}
		</div>
	);
}

function RenameInline({ theme }: { theme: CustomTheme }) {
	const t = useTranslations(
		"pages.housekeeping.domains.hotel.routes.themeManager",
	);
	const [editing, setEditing] = useState(false);
	const [val, setVal] = useState(theme.name);

	if (!editing) {
		return (
			<button
				type="button"
				onClick={() => setEditing(true)}
				className="text-xs font-medium text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
			>
				{t("rename")}
			</button>
		);
	}

	return (
		<form action={renameTheme} className="flex items-center gap-1">
			<input type="hidden" name="id" value={theme.id} />
			<input
				name="name"
				value={val}
				onChange={(e) => setVal(e.target.value)}
				className="w-28 px-1.5 py-0.5 rounded-md border bg-[var(--admin-canvas)] text-[var(--admin-text)] text-xs"
				style={{ borderColor: "var(--admin-border)" }}
			/>
			<button
				type="submit"
				className="text-xs font-semibold text-[var(--admin-accent)]"
			>
				{t("renameSave")}
			</button>
			<button
				type="button"
				onClick={() => setEditing(false)}
				className="text-xs text-[var(--admin-text-muted)]"
			>
				✕
			</button>
		</form>
	);
}

function OverlayOpacityField({
	defaultValue = "0",
}: {
	defaultValue?: string;
}) {
	const t = useTranslations(
		"pages.housekeeping.domains.hotel.routes.themeManager",
	);
	const parsed = /^\d{1,2}$/.test(defaultValue)
		? Math.min(Number(defaultValue), OVERLAY_OPACITY_MAX)
		: 0;
	const [value, setValue] = useState(parsed);
	return (
		<div className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)] sm:col-span-2 lg:col-span-2">
			<label
				htmlFor="background_overlay_opacity"
				className="flex items-center justify-between"
			>
				<span>{t("backgroundOverlayOpacityLabel")}</span>
				<span className="font-semibold text-[var(--admin-text)] tabular-nums">
					{value}%
				</span>
			</label>
			<input
				id="background_overlay_opacity"
				type="range"
				name="background_overlay_opacity"
				min={0}
				max={OVERLAY_OPACITY_MAX}
				step={5}
				value={value}
				onChange={(e) => setValue(Number(e.target.value))}
				className="accent-[var(--admin-accent)] py-2"
				style={{ border: "none", background: "transparent" }}
			/>
		</div>
	);
}

export function ThemeManagerPanel({
	themes,
	current,
	background,
	activeName,
	notice,
}: ThemeManagerPanelProps) {
	const t = useTranslations(
		"pages.housekeeping.domains.hotel.routes.themeManager",
	);
	const [saveName, setSaveName] = useState("");
	const [importName, setImportName] = useState("");
	const [importError, setImportError] = useState(false);
	const uploadFormRef = useRef<HTMLFormElement>(null);

	const noticeKey = notice as
		| "saved"
		| "applied"
		| "renamed"
		| "deleted"
		| "imported"
		| "preset"
		| "background"
		| "importError"
		| "backgroundError"
		| undefined;

	return (
		<div className="space-y-6">
			{noticeKey ? (
				<div
					role="status"
					className={
						noticeKey === "importError" || noticeKey === "backgroundError"
							? "rounded-lg border border-[var(--admin-error)] bg-[var(--admin-surface)] px-4 py-3 text-sm text-[var(--admin-text)]"
							: "rounded-lg border border-[var(--admin-success)] bg-[var(--admin-surface)] px-4 py-3 text-sm text-[var(--admin-text)]"
					}
				>
					{t(`notice.${noticeKey}`)}
				</div>
			) : null}

			<section className="admin-card p-4">
				<h2 className="admin-section-title">{t("currentThemeTitle")}</h2>
				<p className="mb-3 text-xs text-[var(--admin-text-muted)]">
					{t("currentThemeHint")}
				</p>
				<div className="flex flex-wrap items-center gap-3">
					<Swatches settings={current} size={20} />
					<span className="font-semibold text-[var(--admin-text)]">
						{activeName}
					</span>
					<div className="ml-auto flex flex-wrap items-center gap-2">
						<form action={saveCurrentTheme} className="flex items-center gap-2">
							<input
								type="text"
								name="name"
								value={saveName}
								onChange={(e) => setSaveName(e.target.value)}
								placeholder={t("savePlaceholder")}
								className="px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-sm text-[var(--admin-text)] w-56"
								style={{ borderColor: "var(--admin-border)" }}
							/>
							<Button type="submit" size="sm">
								{t("saveLabel")}
							</Button>
						</form>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => downloadJson(activeName || "My theme", current)}
						>
							{t("exportCurrent")}
						</Button>
					</div>
				</div>
			</section>

			<section className="admin-card p-4">
				<h2 className="admin-section-title">{t("savedThemesTitle")}</h2>
				<p className="mb-3 text-xs text-[var(--admin-text-muted)]">
					{t("savedThemesHint")}
				</p>
				{themes.length === 0 ? (
					<p className="text-xs text-[var(--admin-text-muted)]">
						{t("noThemes")}
					</p>
				) : (
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
						{themes.map((theme) => {
							const active = theme.name === activeName;
							return (
								<div
									className="admin-card p-3 flex flex-col gap-2"
									key={theme.id}
								>
									<div className="flex items-center justify-between gap-2">
										<Swatches settings={theme.settings} size={18} />
										{active ? (
											<span className="rounded-full border border-[var(--admin-success)] px-2 py-0.5 text-xs font-medium text-[var(--admin-success)]">
												{t("active")}
											</span>
										) : null}
									</div>
									<div className="flex items-center justify-between gap-2">
										<span className="truncate font-semibold text-[var(--admin-text)]">
											{theme.name}
										</span>
										<RenameInline theme={theme} />
									</div>
									<div className="flex flex-wrap gap-2">
										<form action={applyTheme}>
											<input type="hidden" name="id" value={theme.id} />
											<Button type="submit" variant="outline" size="sm">
												{t("apply")}
											</Button>
										</form>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => downloadJson(theme.name, theme.settings)}
										>
											{t("export")}
										</Button>
										<form
											action={deleteTheme}
											onSubmit={(e) => {
												if (
													!window.confirm(
														t("deleteConfirm", { name: theme.name }),
													)
												)
													e.preventDefault();
											}}
										>
											<input type="hidden" name="id" value={theme.id} />
											<Button type="submit" variant="destructive" size="sm">
												{t("delete")}
											</Button>
										</form>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</section>

			<section className="admin-card p-4">
				<h2 className="admin-section-title">{t("importTitle")}</h2>
				<p className="mb-3 text-xs text-[var(--admin-text-muted)]">
					{t("importHint")}
				</p>
				<form action={importTheme} className="flex flex-wrap items-end gap-3">
					<label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
						<span>{t("importNameLabel")}</span>
						<input
							type="text"
							name="name"
							value={importName}
							onChange={(e) => setImportName(e.target.value)}
							placeholder={t("importNamePlaceholder")}
							className="px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-sm text-[var(--admin-text)]"
							style={{ borderColor: "var(--admin-border)" }}
						/>
					</label>
					<label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
						<span>{t("importFileLabel")}</span>
						<input
							type="file"
							name="file"
							accept=".json,application/json"
							required
							onChange={(e) => {
								if (!e.target.files?.length) return;
								const file = e.target.files[0];
								void file.text().then((raw) => {
									try {
										JSON.parse(raw);
										setImportError(false);
									} catch {
										setImportError(true);
									}
								});
							}}
							className="rounded-lg border bg-[var(--admin-canvas)] px-2 py-2 text-sm text-[var(--admin-text)] file:mr-2"
							style={{ borderColor: "var(--admin-border)" }}
						/>
					</label>
					<label className="flex items-center gap-2 pb-2 text-sm text-[var(--admin-text)]">
						<input
							type="checkbox"
							name="apply"
							value="1"
							defaultChecked
							className="size-4"
						/>
						{t("importApplyLabel")}
					</label>
					<Button type="submit" size="sm">
						{t("importButton")}
					</Button>
				</form>
				{importError ? (
					<p className="mt-2 text-xs text-[var(--admin-error)]">
						{t("invalidFile")}
					</p>
				) : null}
			</section>

			<section className="admin-card p-4">
				<h2 className="admin-section-title">{t("presetsTitle")}</h2>
				<div className="flex flex-wrap gap-2">
					{Object.entries(PRESETS).map(([name, palette]) => (
						<form key={name} action={applyPresetManager}>
							<input type="hidden" name="preset" value={name} />
							<Button type="submit" variant="outline">
								<span className="flex items-center gap-1">
									{PRESET_SWATCH_KEYS.map((k) => (
										<span
											key={k}
											style={{
												width: 14,
												height: 14,
												borderRadius: 3,
												// k from fixed key list
												background: palette.light[k],
												boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)",
												marginLeft: -3,
											}}
										/>
									))}
								</span>
								{name}
							</Button>
						</form>
					))}
				</div>
			</section>

			<section className="admin-card p-4">
				<h2 className="admin-section-title">{t("backgroundTitle")}</h2>
				<p className="mb-3 text-xs text-[var(--admin-text-muted)]">
					{t("backgroundHint")}
				</p>

				<div className="mb-4">
					<p className="mb-1 text-xs text-[var(--admin-text-muted)]">
						{t("backgroundPreviewLabel")}
					</p>
					<div
						className="h-32 rounded-lg border bg-gradient-to-t from-[var(--admin-canvas)] to-[var(--admin-surface)]"
						style={{
							borderColor: "var(--admin-border)",
							...(background.image
								? {
										backgroundImage: `url("${background.image}")`,
										backgroundPosition: background.position,
										backgroundSize: background.size,
										backgroundRepeat: background.repeat,
									}
								: {}),
							...(background.overlay
								? {
										backgroundColor: `color-mix(in srgb, ${background.overlay} ${Number(background.overlayOpacity) || 0}%, transparent)`,
									}
								: {}),
						}}
					/>
					{background.effect !== "none" ? (
						<p className="mt-1.5 text-xs text-[var(--admin-accent)]">
							{t(`backgroundEffectPreview`, {
								effect: t(`backgroundEffect_${background.effect}`),
							})}
						</p>
					) : null}
				</div>

				<form
					action={saveBackground}
					className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
				>
					<label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
						<span>{t("backgroundUrlLabel")}</span>
						<input
							type="text"
							name="background_image"
							defaultValue={background.image}
							placeholder="/api/media/… or https://…"
							className="px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-sm text-[var(--admin-text)]"
							style={{ borderColor: "var(--admin-border)" }}
						/>
					</label>
					<label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
						<span>{t("backgroundPositionLabel")}</span>
						<select
							name="background_position"
							defaultValue={background.position}
							className="px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-sm text-[var(--admin-text)]"
							style={{ borderColor: "var(--admin-border)" }}
						>
							{BACKGROUND_POSITIONS.map((value) => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
						<span>{t("backgroundSizeLabel")}</span>
						<select
							name="background_size"
							defaultValue={background.size}
							className="px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-sm text-[var(--admin-text)]"
							style={{ borderColor: "var(--admin-border)" }}
						>
							{BACKGROUND_SIZES.map((value) => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
						<span>{t("backgroundRepeatLabel")}</span>
						<select
							name="background_repeat"
							defaultValue={background.repeat}
							className="px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-sm text-[var(--admin-text)]"
							style={{ borderColor: "var(--admin-border)" }}
						>
							{BACKGROUND_REPEATS.map((value) => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
						</select>
					</label>

					<label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)] lg:col-span-2">
						<span>{t("backgroundEffectLabel")}</span>
						<select
							name="background_effect"
							defaultValue={background.effect}
							className="px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-sm text-[var(--admin-text)]"
							style={{ borderColor: "var(--admin-border)" }}
						>
							{BACKGROUND_EFFECTS.map((value) => (
								<option key={value} value={value}>
									{t(`backgroundEffect_${value}`)}
								</option>
							))}
						</select>
					</label>

					<div className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)] lg:col-span-2">
						<label
							htmlFor="background_overlay"
							className="flex items-center justify-between"
						>
							<span>{t("backgroundOverlayLabel")}</span>
							<input
								id="background_overlay"
								name="background_overlay"
								type="color"
								value={
									/^#[0-9a-fA-F]{6}$/.test(background.overlay)
										? background.overlay
										: "#000000"
								}
								className="h-8 w-12 cursor-pointer rounded-md border bg-[var(--admin-canvas)] px-0.5"
								style={{ borderColor: "var(--admin-border)" }}
							/>
						</label>
						<div className="flex flex-wrap items-center gap-1.5">
							{OVERLAY_PRESETS.map((preset) => (
								<button
									key={preset.label}
									type="button"
									title={preset.label}
									onClick={() => {
										const input = document.getElementById(
											"background_overlay",
										) as HTMLInputElement | null;
										if (input) input.value = preset.value || "#000000";
									}}
									className="h-7 w-7 rounded-md border transition-transform hover:scale-110"
									style={{
										borderColor: "var(--admin-border)",
										background:
											preset.value ||
											"linear-gradient(135deg, #64748b, #94a3b8)",
									}}
								/>
							))}
						</div>
					</div>

					<OverlayOpacityField defaultValue={background.overlayOpacity} />

					<div className="sm:col-span-2 lg:col-span-4 flex flex-wrap gap-2">
						<Button type="submit" size="sm">
							{t("applyBackground")}
						</Button>
					</div>
				</form>
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<form ref={uploadFormRef} action={uploadBackground}>
						<label className="inline-flex cursor-pointer items-center gap-2 text-sm">
							<input
								type="file"
								name="file"
								accept="image/*"
								className="hidden"
								onChange={(e) => {
									if (e.target.files?.length)
										uploadFormRef.current?.requestSubmit();
								}}
							/>
							<span className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-2 text-sm font-medium transition-all hover:bg-accent hover:text-accent-foreground">
								{t("uploadButton")}
							</span>
						</label>
					</form>
					{background.image ? (
						<form action={clearBackground}>
							<Button type="submit" variant="outline" size="sm">
								{t("clearBackground")}
							</Button>
						</form>
					) : null}
				</div>
			</section>
		</div>
	);
}
