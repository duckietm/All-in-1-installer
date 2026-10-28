"use client";

import { useState } from "react";
import {
	deleteScope,
	duplicateScope,
	saveScopeValues,
} from "@/actions/theme-builder";
import { ColorField } from "@/components/admin/color-field";
import { Button } from "@/components/ui/button";
import {
	BLOCK_KEY_PREFIX,
	type EffectKey,
	getBlocksByCategory,
	type LayoutKey,
	type MediaKey,
} from "@/lib/theme-blocks";
import type { ThemeColorKey } from "@/lib/theme-presets";

interface ScopeInfo {
	id: number;
	name: string;
	type: string;
	parentId: number | null;
	siteDomain: string | null;
	routePath: string | null;
	moduleId: string | null;
	isActive: boolean;
}

interface ScopeValues {
	light: Record<string, string>;
	dark: Record<string, string>;
	blocks: Record<string, string>;
	layout: Record<string, string | undefined>;
	effects: Record<string, string | undefined>;
	media: Record<string, string | undefined>;
	custom: Record<string, string | undefined>;
}

// ─── Color fields ────────────────────────────────────────────────────────────

const COLOR_FIELDS: Array<{
	key: ThemeColorKey;
	label: string;
	def: string;
	desc: string;
	bgKey?: string;
}> = [
	{
		key: "color_background",
		label: "Page background",
		def: "#f8fafc",
		desc: "Main page background",
	},
	{
		key: "color_surface",
		label: "Card / surface",
		def: "#ffffff",
		desc: "Cards, panels, elevated surfaces",
	},
	{
		key: "color_dropdown",
		label: "Dropdown",
		def: "#ffffff",
		desc: "Dropdown menus",
	},
	{
		key: "color_navbar",
		label: "Navbar",
		def: "#ffffff",
		desc: "Navigation bar background",
	},
	{
		key: "color_navbar_text",
		label: "Navbar text",
		def: "#1e293b",
		desc: "Nav text color",
		bgKey: "color_navbar",
	},
	{
		key: "color_text",
		label: "Body text",
		def: "#0f172a",
		desc: "Main text color",
		bgKey: "color_surface",
	},
	{
		key: "color_text_muted",
		label: "Muted text",
		def: "#64748b",
		desc: "Secondary text",
		bgKey: "color_surface",
	},
	{
		key: "color_primary",
		label: "Primary accent",
		def: "#f59e0b",
		desc: "Main brand color",
	},
	{
		key: "color_accent",
		label: "Secondary accent",
		def: "#10b981",
		desc: "Secondary brand color",
	},
	{
		key: "color_success",
		label: "Success",
		def: "#16a34a",
		desc: "Success states",
	},
	{
		key: "color_warning",
		label: "Warning",
		def: "#eab308",
		desc: "Warning states",
	},
	{ key: "color_error", label: "Error", def: "#ef4444", desc: "Error states" },
	{
		key: "color_info",
		label: "Info",
		def: "#0ea5e9",
		desc: "Information states",
	},
	{
		key: "button_primary_color",
		label: "Button primary",
		def: "#f59e0b",
		desc: "Primary button background",
	},
	{
		key: "button_text_color",
		label: "Button primary text",
		def: "#1e293b",
		desc: "Primary button text",
	},
	{
		key: "button_secondary_color",
		label: "Button secondary",
		def: "#22c55e",
		desc: "Secondary button background",
	},
	{
		key: "button_secondary_text_color",
		label: "Button secondary text",
		def: "#ffffff",
		desc: "Secondary button text",
	},
	{
		key: "button_danger_color",
		label: "Button danger",
		def: "#ef4444",
		desc: "Danger button background",
	},
	{
		key: "button_danger_text_color",
		label: "Button danger text",
		def: "#ffffff",
		desc: "Danger button text",
	},
	{
		key: "button_outline_color",
		label: "Button outline",
		def: "#eeb425",
		desc: "Outline button border",
	},
	{
		key: "button_outline_text_color",
		label: "Button outline text",
		def: "#1a1a2e",
		desc: "Outline button text",
	},
	{
		key: "link_color",
		label: "Link color",
		def: "#b77900",
		desc: "Link text color",
	},
	{
		key: "link_hover_color",
		label: "Link hover",
		def: "#8a5b00",
		desc: "Link hover color",
	},
	{
		key: "border_color",
		label: "Border color",
		def: "#eeb425",
		desc: "General borders",
	},
	{
		key: "panel_border_color",
		label: "Panel border",
		def: "#e9b124",
		desc: "Panel borders",
	},
	{
		key: "gradient_from",
		label: "Gradient start",
		def: "#f59e0b",
		desc: "Gradient from color",
	},
	{
		key: "gradient_to",
		label: "Gradient end",
		def: "#10b981",
		desc: "Gradient to color",
	},
];

// ─── Layout fields ───────────────────────────────────────────────────────────

const LAYOUT_FIELDS: Array<{
	key: LayoutKey;
	label: string;
	def: string;
	desc: string;
	type?: string;
}> = [
	{
		key: "layout:max_width",
		label: "Max Width",
		def: "1280px",
		desc: "Maximum content width",
	},
	{
		key: "layout:spacing",
		label: "Grid Spacing",
		def: "1.5rem",
		desc: "Gap between grid items",
	},
	{
		key: "layout:grid_columns",
		label: "Grid Columns",
		def: "12",
		desc: "Number of grid columns",
		type: "number",
	},
	{
		key: "layout:content_padding",
		label: "Content Padding",
		def: "0.75rem",
		desc: "Horizontal padding on content",
	},
	{
		key: "layout:navbar_height",
		label: "Navbar Height",
		def: "56px",
		desc: "Height of the navigation bar",
	},
];

// ─── Effect fields ───────────────────────────────────────────────────────────

const EFFECT_FIELDS: Array<{
	key: EffectKey;
	label: string;
	def: string;
	desc: string;
	type?: string;
}> = [
	{
		key: "effect:card_shadow",
		label: "Card Shadow",
		def: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
		desc: "Default card box shadow",
	},
	{
		key: "effect:card_shadow_hover",
		label: "Card Shadow (hover)",
		def: "0 8px 24px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.06)",
		desc: "Card box shadow on hover",
	},
	{
		key: "effect:border_style",
		label: "Border Style",
		def: "solid",
		desc: "CSS border-style (solid, dashed, dotted, etc.)",
	},
	{
		key: "effect:border_width",
		label: "Border Width",
		def: "1px",
		desc: "Default border width",
	},
	{
		key: "effect:transition_duration",
		label: "Transition Duration",
		def: "200ms",
		desc: "Duration for hover/transition effects",
	},
	{
		key: "effect:animation_scale",
		label: "Animation Scale",
		def: "1",
		desc: "Scale factor for animations (1 = normal)",
		type: "number",
	},
];

// ─── Media fields ────────────────────────────────────────────────────────────

const MEDIA_FIELDS: Array<{
	key: MediaKey;
	label: string;
	def: string;
	desc: string;
	type?: string;
}> = [
	{
		key: "media:logo_url",
		label: "Logo URL",
		def: "",
		desc: "Custom logo image URL (overrides default)",
	},
	{
		key: "media:background_image",
		label: "Background Image",
		def: "",
		desc: "Page background image URL",
	},
	{
		key: "media:background_position",
		label: "Background Position",
		def: "center",
		desc: "CSS background-position",
	},
	{
		key: "media:background_size",
		label: "Background Size",
		def: "cover",
		desc: "CSS background-size (cover, contain, auto)",
	},
	{
		key: "media:background_repeat",
		label: "Background Repeat",
		def: "no-repeat",
		desc: "CSS background-repeat",
	},
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getVal(
	values: ScopeValues | null,
	key: string,
	mode: "light" | "dark",
): string {
	if (!values) return "";
	if (key.startsWith("block:")) return values.blocks[key] ?? "";
	if (key.startsWith("layout:")) return values.layout[key] ?? "";
	if (key.startsWith("effect:")) return values.effects[key] ?? "";
	if (key.startsWith("media:")) return values.media[key] ?? "";
	if (key.startsWith("custom:")) return values.custom[key] ?? "";
	if (mode === "dark") return values.dark[key] ?? "";
	return values.light[key] ?? "";
}

const TYPE_LABELS: Record<string, string> = {
	global: "🌍 Global",
	site: "🌐 Site",
	module: "📦 Module",
	route: "📄 Route",
};

type Tab = "colors" | "blocks" | "layout" | "effects" | "media" | "custom";

// ─── Main Component ──────────────────────────────────────────────────────────

export function ThemeEditor({
	scopeId,
	scopes,
	values,
}: {
	scopeId: number;
	scopes: ScopeInfo[];
	values: ScopeValues;
}) {
	const [mode, setMode] = useState<"light" | "dark">("light");
	const [tab, setTab] = useState<Tab>("colors");

	const scope = scopes.find((s) => s.id === scopeId);
	if (!scope) return null;

	const tabs: Array<{ id: Tab; label: string; icon: string }> = [
		{ id: "colors", label: "Colors", icon: "🎨" },
		{ id: "blocks", label: "Blocks", icon: "🧩" },
		{ id: "layout", label: "Layout", icon: "📐" },
		{ id: "effects", label: "Effects", icon: "✨" },
		{ id: "media", label: "Media", icon: "🖼" },
		{ id: "custom", label: "Custom", icon: "💻" },
	];

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="admin-card p-4">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-lg font-semibold text-[var(--admin-text)]">
							{TYPE_LABELS[scope.type] ?? scope.type} — {scope.name}
						</h2>
						<p className="text-xs text-[var(--admin-text-muted)] mt-1">
							{scope.type === "route" && `Path: ${scope.routePath}`}
							{scope.type === "module" && `Module: ${scope.moduleId}`}
							{scope.type === "site" && `Domain: ${scope.siteDomain}`}
							{scope.type === "global" &&
								"Applies to all pages (default theme)"}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<form action={duplicateScope} className="inline">
							<input type="hidden" name="id" value={scopeId} />
							<Button type="submit" variant="outline" size="sm">
								Duplicate
							</Button>
						</form>
						{scope.type !== "global" ? (
							<form action={deleteScope} className="inline">
								<input type="hidden" name="id" value={scopeId} />
								<Button
									type="submit"
									variant="outline"
									size="sm"
									className="text-[var(--admin-error)] hover:text-[var(--admin-error)]/80"
									onClick={(e) => {
										if (
											!confirm("Delete this scope and all its theme values?")
										) {
											e.preventDefault();
										}
									}}
								>
									Delete
								</Button>
							</form>
						) : null}
					</div>
				</div>
			</div>

			{/* Mode toggle (only for colors tab) */}
			{tab === "colors" && (
				<div className="flex items-center gap-2">
					<span className="text-xs text-[var(--admin-text-muted)]">
						Editing:
					</span>
					<div className="flex rounded-lg border border-[var(--admin-border)] overflow-hidden">
						<button
							type="button"
							onClick={() => setMode("light")}
							className={`px-3 py-1.5 text-xs font-medium transition-colors ${
								mode === "light"
									? "bg-[var(--admin-accent)] text-[var(--admin-accent-text)]"
									: "bg-[var(--admin-surface)] text-[var(--admin-text)] hover:bg-[var(--admin-surface-elevated)]"
							}`}
						>
							☀ Light
						</button>
						<button
							type="button"
							onClick={() => setMode("dark")}
							className={`px-3 py-1.5 text-xs font-medium transition-colors ${
								mode === "dark"
									? "bg-[var(--admin-accent)] text-[var(--admin-accent-text)]"
									: "bg-[var(--admin-surface)] text-[var(--admin-text)] hover:bg-[var(--admin-surface-elevated)]"
							}`}
						>
							☾ Dark
						</button>
					</div>
				</div>
			)}

			{/* Tabs */}
			<div className="flex gap-1 overflow-x-auto pb-1">
				{tabs.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => setTab(t.id)}
						className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
							tab === t.id
								? "bg-[var(--admin-accent)]/15 text-[var(--admin-accent)]"
								: "text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-elevated)] hover:text-[var(--admin-text)]"
						}`}
					>
						<span>{t.icon}</span>
						<span>{t.label}</span>
					</button>
				))}
			</div>

			{/* Tab content */}
			<form action={saveScopeValues}>
				<input type="hidden" name="scope_id" value={scopeId} />

				{tab === "colors" && <ColorsTab values={values} mode={mode} />}
				{tab === "blocks" && <BlocksTab values={values} />}
				{tab === "layout" && <LayoutTab values={values} />}
				{tab === "effects" && <EffectsTab values={values} />}
				{tab === "media" && <MediaTab values={values} />}
				{tab === "custom" && <CustomTab values={values} />}

				<div className="flex justify-end gap-2 mt-4">
					<Button type="submit" variant="default">
						Save Theme Values
					</Button>
				</div>
			</form>
		</div>
	);
}

// ─── Colors Tab ──────────────────────────────────────────────────────────────

function ColorsTab({
	values,
	mode,
}: {
	values: ScopeValues;
	mode: "light" | "dark";
}) {
	return (
		<div className="admin-card p-4">
			<h3 className="text-sm font-semibold text-[var(--admin-text)] mb-4">
				Colors ({mode} mode)
			</h3>
			<p className="text-xs text-[var(--admin-text-muted)] mb-4">
				Only values you set here override the parent scope. Leave empty to
				inherit.
			</p>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{COLOR_FIELDS.map((field) => (
					<ColorField
						key={`${field.key}-${mode}`}
						name={`${field.key}_${mode}`}
						label={field.label}
						description={field.desc}
						defaultValue={getVal(values, field.key, mode) || field.def}
						bgValue={
							field.bgKey
								? getVal(values, field.bgKey, mode) || undefined
								: undefined
						}
					/>
				))}
			</div>
		</div>
	);
}

// ─── Blocks Tab ──────────────────────────────────────────────────────────────

function BlocksTab({ values }: { values: ScopeValues }) {
	const grouped = getBlocksByCategory();

	const categoryLabels: Record<string, string> = {
		chrome: "Site Chrome",
		layout: "Layout",
		components: "Components",
		effects: "Effects",
	};

	return (
		<div className="space-y-4">
			{Object.entries(grouped).map(([category, blocks]) => (
				<div key={category} className="admin-card p-4">
					<h3 className="text-sm font-semibold text-[var(--admin-text)] mb-1">
						{categoryLabels[category] ?? category}
					</h3>
					<p className="text-xs text-[var(--admin-text-muted)] mb-4">
						Toggle visibility of blocks in this scope. Hidden blocks use{" "}
						<code className="bg-[var(--admin-surface-elevated)] px-1 rounded">
							display: none
						</code>
						.
					</p>

					<div className="space-y-2">
						{blocks.map((block) => {
							const key = `${BLOCK_KEY_PREFIX}${block.id}`;
							const currentVal = values.blocks[key];
							const isChecked =
								currentVal === "true" ||
								(currentVal === undefined && block.defaultVisible);

							return (
								<label
									key={block.id}
									className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--admin-surface-elevated)] cursor-pointer"
								>
									<input
										type="checkbox"
										name={key}
										defaultChecked={isChecked}
										className="h-4 w-4 rounded border-[var(--admin-border)] text-[var(--admin-accent)] focus:ring-[var(--admin-accent)]"
									/>
									<div className="flex-1 min-w-0">
										<span className="text-sm text-[var(--admin-text)]">
											{block.label}
										</span>
										<span className="text-xs text-[var(--admin-text-muted)] ml-2">
											{block.description}
										</span>
									</div>
									<code className="text-[10px] text-[var(--admin-text-muted)] font-mono">
										{block.selector}
									</code>
								</label>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}

// ─── Layout Tab ──────────────────────────────────────────────────────────────

function LayoutTab({ values }: { values: ScopeValues }) {
	return (
		<div className="admin-card p-4">
			<h3 className="text-sm font-semibold text-[var(--admin-text)] mb-4">
				Layout Settings
			</h3>
			<p className="text-xs text-[var(--admin-text-muted)] mb-4">
				Control spacing, width, and grid settings for this scope. Values are
				applied as CSS custom properties.
			</p>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{LAYOUT_FIELDS.map((field) => (
					<div key={field.key} className="rounded-lg p-2">
						<label className="block text-sm font-semibold text-[var(--admin-text)] mb-1">
							{field.label}
							<p className="text-xs text-[var(--admin-text-muted)] mb-2 font-normal">
								{field.desc}
							</p>
							<input
								type={field.type || "text"}
								name={field.key}
								defaultValue={getVal(values, field.key, "light") || field.def}
								className="w-full px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-[var(--admin-text)] text-sm font-mono"
								style={{ borderColor: "var(--admin-border)" }}
							/>
						</label>
					</div>
				))}
			</div>
		</div>
	);
}

// ─── Effects Tab ─────────────────────────────────────────────────────────────

function EffectsTab({ values }: { values: ScopeValues }) {
	return (
		<div className="admin-card p-4">
			<h3 className="text-sm font-semibold text-[var(--admin-text)] mb-4">
				Effects & Transitions
			</h3>
			<p className="text-xs text-[var(--admin-text-muted)] mb-4">
				Control shadows, borders, and animation timing for this scope.
			</p>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{EFFECT_FIELDS.map((field) => (
					<div key={field.key} className="rounded-lg p-2">
						<label className="block text-sm font-semibold text-[var(--admin-text)] mb-1">
							{field.label}
							<p className="text-xs text-[var(--admin-text-muted)] mb-2 font-normal">
								{field.desc}
							</p>
							<input
								type={field.type || "text"}
								name={field.key}
								defaultValue={getVal(values, field.key, "light") || field.def}
								className="w-full px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-[var(--admin-text)] text-sm font-mono"
								style={{ borderColor: "var(--admin-border)" }}
							/>
						</label>
					</div>
				))}
			</div>
		</div>
	);
}

// ─── Media Tab ───────────────────────────────────────────────────────────────

function MediaTab({ values }: { values: ScopeValues }) {
	return (
		<div className="admin-card p-4">
			<h3 className="text-sm font-semibold text-[var(--admin-text)] mb-4">
				Media & Backgrounds
			</h3>
			<p className="text-xs text-[var(--admin-text-muted)] mb-4">
				Set custom logos, background images, and background properties for this
				scope.
			</p>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				{MEDIA_FIELDS.map((field) => (
					<div key={field.key} className="rounded-lg p-2">
						<label className="block text-sm font-semibold text-[var(--admin-text)] mb-1">
							{field.label}
							<p className="text-xs text-[var(--admin-text-muted)] mb-2 font-normal">
								{field.desc}
							</p>
							<input
								type={field.type || "text"}
								name={field.key}
								defaultValue={getVal(values, field.key, "light") || field.def}
								placeholder={field.def}
								className="w-full px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-[var(--admin-text)] text-sm"
								style={{ borderColor: "var(--admin-border)" }}
							/>
						</label>
					</div>
				))}
			</div>
		</div>
	);
}

// ─── Custom Tab ──────────────────────────────────────────────────────────────

function CustomTab({ values }: { values: ScopeValues }) {
	return (
		<div className="space-y-4">
			<div className="admin-card p-4">
				<h3 className="text-sm font-semibold text-[var(--admin-text)] mb-4">
					Custom CSS
				</h3>
				<p className="text-xs text-[var(--admin-text-muted)] mb-4">
					Add custom CSS that applies within this scope. Use{" "}
					<code className="bg-[var(--admin-surface-elevated)] px-1 rounded">
						&{" "}
					</code>{" "}
					as a placeholder for the scope selector (e.g.{" "}
					<code className="bg-[var(--admin-surface-elevated)] px-1 rounded">
						& .content-card {"{"} border: 2px solid red; {"}"}
					</code>
					).
				</p>
				<textarea
					name="custom:css"
					defaultValue={getVal(values, "custom:css", "light")}
					rows={8}
					placeholder={".content-card { border-radius: 20px; }"}
					className="w-full px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-[var(--admin-text)] text-sm font-mono resize-y"
					style={{ borderColor: "var(--admin-border)" }}
				/>
			</div>

			<div className="admin-card p-4">
				<h3 className="text-sm font-semibold text-[var(--admin-text)] mb-4">
					Custom HTML
				</h3>
				<p className="text-xs text-[var(--admin-text-muted)] mb-4">
					Add custom HTML that injects into the page for this scope. Use for
					custom banners, scripts, or content blocks.
				</p>
				<textarea
					name="custom:html"
					defaultValue={getVal(values, "custom:html", "light")}
					rows={6}
					placeholder='<div class="my-banner">Welcome!</div>'
					className="w-full px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-[var(--admin-text)] text-sm font-mono resize-y"
					style={{ borderColor: "var(--admin-border)" }}
				/>
			</div>
		</div>
	);
}
