import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
	applyCustomTheme,
	applyPreset,
	deleteCustomTheme,
	saveCustomTheme,
	saveTheme,
} from "@/actions/admin-theme";
import { ColorField } from "@/components/admin/color-field";
import { RenameTheme } from "@/components/admin/theme/rename-theme";
import { Button } from "@/components/ui/button";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";
import { listCustomThemes } from "@/lib/theme-custom-store";
import { FONTS, PRESETS } from "@/lib/theme-presets";

export const metadata = { title: "Theme" };

const COLOR_FIELDS: {
	key: string;
	label: string;
	def: string;
	desc: string;
	bgKey?: string;
}[] = [
	{
		key: "color_background",
		label: "Page background",
		def: "#f8fafc",
		desc: "Main page background behind all content",
	},
	{
		key: "color_surface",
		label: "Card / surface",
		def: "#ffffff",
		desc: "Cards, panels, and elevated surfaces",
	},
	{
		key: "color_dropdown",
		label: "Dropdown menu",
		def: "#ffffff",
		desc: "Dropdown menus and input backgrounds",
	},
	{
		key: "color_navbar",
		label: "Navbar bar",
		def: "#ffffff",
		desc: "Top navigation bar background",
	},
	{
		key: "color_navbar_text",
		label: "Navbar text",
		def: "#1e293b",
		desc: "Text color in the navigation bar",
		bgKey: "color_navbar",
	},
	{
		key: "color_text",
		label: "Body text",
		def: "#0f172a",
		desc: "Main body text — must contrast with background/surface",
		bgKey: "color_surface",
	},
	{
		key: "color_text_muted",
		label: "Muted text",
		def: "#64748b",
		desc: "Secondary text, labels, hints — lighter than body text",
		bgKey: "color_surface",
	},
	{
		key: "color_primary",
		label: "Primary accent",
		def: "#f59e0b",
		desc: "Main brand color, highlights, active elements",
	},
	{
		key: "color_accent",
		label: "Secondary accent",
		def: "#10b981",
		desc: "Secondary brand color, success-oriented highlights",
	},
	{
		key: "border_color",
		label: "Border (golden)",
		def: "#eeb425",
		desc: "Borders, dividers, outlines",
	},
	{
		key: "panel_border_color",
		label: "Panel border",
		def: "#e9b124",
		desc: "Border color of home page panels and cards",
	},
	{
		key: "color_success",
		label: "Success",
		def: "#16a34a",
		desc: "Positive status (green)",
	},
	{
		key: "color_warning",
		label: "Warning",
		def: "#eab308",
		desc: "Warning status (yellow)",
	},
	{
		key: "color_error",
		label: "Error",
		def: "#ef4444",
		desc: "Error status (red)",
	},
	{
		key: "color_info",
		label: "Info",
		def: "#0ea5e9",
		desc: "Info status (blue)",
	},
];

const BUTTON_FIELDS: {
	key: string;
	label: string;
	def: string;
	desc: string;
	bgKey?: string;
}[] = [
	{
		key: "button_primary_color",
		label: "Primary button",
		def: "#f59e0b",
		desc: "Main call-to-action button background",
	},
	{
		key: "button_text_color",
		label: "Button text",
		def: "#1e293b",
		desc: "Text on primary buttons — must contrast with button color",
		bgKey: "button_primary_color",
	},
	{
		key: "button_secondary_color",
		label: "Secondary button",
		def: "#22c55e",
		desc: "Secondary action button background",
	},
	{
		key: "button_secondary_text_color",
		label: "Secondary text",
		def: "#ffffff",
		desc: "Text on secondary buttons",
		bgKey: "button_secondary_color",
	},
	{
		key: "button_danger_color",
		label: "Danger button",
		def: "#ef4444",
		desc: "Destructive action button (delete, ban)",
	},
	{
		key: "button_danger_text_color",
		label: "Danger text",
		def: "#ffffff",
		desc: "Text on danger buttons",
		bgKey: "button_danger_color",
	},
	{
		key: "button_outline_color",
		label: "Outline border",
		def: "#eeb425",
		desc: "Outline button border color",
	},
	{
		key: "button_outline_text_color",
		label: "Outline text",
		def: "#1a1a2e",
		desc: "Text on outline buttons",
		bgKey: "color_surface",
	},
	{
		key: "link_color",
		label: "Link",
		def: "#eeb425",
		desc: "Hyperlink text color",
		bgKey: "color_surface",
	},
	{
		key: "link_hover_color",
		label: "Link hover",
		def: "#cf9d15",
		desc: "Hyperlink text on hover",
		bgKey: "color_surface",
	},
];

const GRADIENT_FIELDS: {
	key: string;
	label: string;
	def: string;
	desc: string;
}[] = [
	{
		key: "gradient_from",
		label: "Gradient start",
		def: "#f59e0b",
		desc: "Left/top color of card header and hero gradients",
	},
	{
		key: "gradient_to",
		label: "Gradient end",
		def: "#10b981",
		desc: "Right/bottom color of card header and hero gradients",
	},
];

const HEADINGS: { key: string; label: string; def: string }[] = [
	{ key: "size_heading_h1", label: "H1", def: "30" },
	{ key: "size_heading_h2", label: "H2", def: "22" },
	{ key: "size_heading_h3", label: "H3", def: "18" },
];

const ADMIN_FIELDS: {
	key: string;
	label: string;
	def: string;
	desc: string;
	bgKey?: string;
}[] = [
	{
		key: "admin_canvas",
		label: "Page background (dark)",
		def: "#0f172a",
		desc: "Dark-mode admin canvas. Light mode follows the public light palette.",
	},
	{
		key: "admin_surface",
		label: "Card / panel (dark)",
		def: "#1e293b",
		desc: "Dark-mode cards, tables, and panels",
	},
	{
		key: "admin_text",
		label: "Body text (dark)",
		def: "#f1f5f9",
		desc: "Dark-mode text — must contrast with canvas/surface",
		bgKey: "admin_canvas",
	},
	{
		key: "admin_text_muted",
		label: "Muted text (dark)",
		def: "#94a3b8",
		desc: "Dark-mode secondary labels and hints",
		bgKey: "admin_canvas",
	},
	{
		key: "admin_border",
		label: "Border (dark)",
		def: "#334155",
		desc: "Dark-mode table borders, dividers, input outlines",
	},
	{
		key: "admin_sidebar_bg",
		label: "Sidebar (dark)",
		def: "#0f172a",
		desc: "Dark-mode left navigation background",
	},
];

const ALL_COLORS = [...COLOR_FIELDS, ...BUTTON_FIELDS, ...GRADIENT_FIELDS];

function toHex(value: string | null, def: string): string {
	return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : def;
}

interface ThemeField {
	key: string;
	label: string;
	def: string;
	desc: string;
	bgKey?: string;
}

function colorFields(
	fields: ThemeField[],
	current: Record<string, string>,
	suffix = "",
) {
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
				gap: "0.5rem",
			}}
		>
			{fields.map((f) => {
				const val = toHex(current[f.key], f.def);
				const bgKey = f.bgKey ? `${f.bgKey}${suffix}` : undefined;
				const bgValue = bgKey ? toHex(current[bgKey], "") : undefined;
				return (
					<ColorField
						key={f.key}
						label={f.label}
						description={f.desc}
						defaultValue={val}
						bgValue={bgValue || undefined}
						name={`${f.key}${suffix}`}
					/>
				);
			})}
		</div>
	);
}

export default async function AdminTheme({
	searchParams,
}: {
	searchParams: Promise<{
		saved?: string;
		preset?: string;
		savedTheme?: string;
		theme?: string;
		renamed?: string;
		deletedTheme?: string;
		error?: string;
	}>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SETTINGS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.theme");

	const sp = await searchParams;

	const current = Object.fromEntries(
		await Promise.all(
			[...ALL_COLORS, ...ADMIN_FIELDS].map(
				async (f) =>
					[f.key, (await siteSettings.get(f.key, f.def)) ?? f.def] as const,
			),
		),
	) as Record<string, string>;
	const defaultPreset = PRESETS["Atom (golden)"];
	const currentDark = Object.fromEntries(
		await Promise.all(
			ALL_COLORS.map(
				async (f) =>
					[
						f.key,
						(await siteSettings.get(
							`${f.key}_dark`,
							defaultPreset.dark[f.key as keyof typeof defaultPreset.dark],
						)) ?? defaultPreset.dark[f.key as keyof typeof defaultPreset.dark],
					] as const,
			),
		),
	) as Record<string, string>;
	const customThemes = await listCustomThemes();
	const radius = (await siteSettings.get("border_radius", "12")) ?? "12";
	const fontKey = (await siteSettings.get("font_family", "nunito")) ?? "nunito";
	const headings = Object.fromEntries(
		await Promise.all(
			HEADINGS.map(
				async (h) =>
					[h.key, (await siteSettings.get(h.key, h.def)) ?? h.def] as const,
			),
		),
	) as Record<string, string>;
	const customCss = (await siteSettings.get("custom_css", "")) ?? "";

	return (
		<main>
			{sp.error ? (
				<div
					role="alert"
					className="mb-4 p-3 rounded-lg text-xs text-[var(--admin-error)]"
				>
					{t("saveError")}
				</div>
			) : null}
			{sp.saved ? (
				<div className="mb-4 p-3 rounded-lg theme-status-success text-xs">
					{t("saved")}
				</div>
			) : null}
			{sp.preset ? (
				<div className="mb-4 p-3 rounded-lg theme-status-success text-xs">
					{t("presetApplied", { preset: sp.preset })}
				</div>
			) : null}
			{sp.savedTheme ? (
				<div className="mb-4 p-3 rounded-lg theme-status-success text-xs">
					Theme saved as preset.
				</div>
			) : null}
			{sp.theme ? (
				<div className="mb-4 p-3 rounded-lg theme-status-success text-xs">
					Applied theme “{sp.theme}”.
				</div>
			) : null}
			{sp.renamed ? (
				<div className="mb-4 p-3 rounded-lg theme-status-success text-xs">
					Theme renamed.
				</div>
			) : null}
			{sp.deletedTheme ? (
				<div className="mb-4 p-3 rounded-lg theme-status-success text-xs">
					Theme deleted.
				</div>
			) : null}

			<section className="mt-6">
				<h2 className="admin-section-title">{t("presetsTitle")}</h2>
				<div className="flex flex-wrap gap-2">
					{Object.entries(PRESETS).map(([name, palette]) => (
						<form key={name} action={applyPreset}>
							<input type="hidden" name="preset" value={name} />
							<Button type="submit" variant="outline">
								<span className="flex items-center gap-1">
									{[
										"color_primary",
										"color_accent",
										"color_surface",
										"color_text",
									].map((k) => (
										<span
											key={k}
											style={{
												width: 14,
												height: 14,
												borderRadius: 3,
												background:
													palette.light[k as keyof typeof palette.light],
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

			<section className="mt-6">
				<h2 className="admin-section-title">Your saved themes</h2>
				<p className="text-xs text-[var(--admin-text-muted)] mb-3">
					Save the current configuration as a named preset, then load it
					anytime. Perfect for keeping multiple brand themes ready to switch.
				</p>
				<form
					action={saveCustomTheme}
					className="flex flex-wrap items-center gap-2 mb-4"
				>
					<input
						type="text"
						name="name"
						placeholder="Theme name (e.g. Summer Gold)"
						className="px-3 py-2 rounded-lg border bg-[var(--admin-canvas)] text-[var(--admin-text)] text-sm w-64"
						style={{ borderColor: "var(--admin-border)" }}
					/>
					<Button type="submit" variant="default">
						Save current theme
					</Button>
				</form>

				{customThemes.length === 0 ? (
					<p className="text-xs text-[var(--admin-text-muted)]">
						No saved themes yet — save one above.
					</p>
				) : (
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
						{customThemes.map((theme) => (
							<div
								key={theme.id}
								className="admin-card p-3 flex flex-col gap-2"
							>
								<div className="flex items-center gap-1">
									{[
										"color_primary",
										"color_accent",
										"color_surface",
										"color_text",
									].map((k) => (
										<span
											key={k}
											style={{
												width: 20,
												height: 20,
												borderRadius: 4,
												// k from fixed theme color key list
												background: theme.settings[k] ?? "#64748b",
												boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)",
											}}
										/>
									))}
								</div>
								<div className="flex items-center justify-between gap-2">
									<span className="font-semibold text-[var(--admin-text)] truncate">
										{theme.name}
									</span>
									<RenameTheme id={theme.id} name={theme.name} />
								</div>
								<div className="flex gap-2">
									<form action={applyCustomTheme}>
										<input type="hidden" name="id" value={theme.id} />
										<Button type="submit" variant="outline" size="sm">
											Load
										</Button>
									</form>
									<form action={deleteCustomTheme}>
										<input type="hidden" name="id" value={theme.id} />
										<Button type="submit" variant="destructive" size="sm">
											Delete
										</Button>
									</form>
								</div>
							</div>
						))}
					</div>
				)}
			</section>

			<form action={saveTheme}>
				<h2 className="mt-6 text-lg font-extrabold">☀ Light mode</h2>
				<p className="text-xs text-[var(--admin-text-muted)] mb-3 mt-1">
					These colors are used when visitors view your site in light mode
					(default). Make sure body text contrasts well with both the page
					background and card surface.
				</p>

				<section className="mt-6">
					<h2 className="admin-section-title">Page &amp; text colors</h2>
					<p className="text-xs text-[var(--admin-text-muted)] mb-2">
						Backgrounds, surfaces, and text colors. Text colors must contrast
						with their backgrounds for readability.
					</p>
					<div className="admin-card">{colorFields(COLOR_FIELDS, current)}</div>
				</section>

				<section className="mt-6">
					<h2 className="admin-section-title">Buttons &amp; links</h2>
					<p className="text-xs text-[var(--admin-text-muted)] mb-2">
						Button backgrounds, text on buttons, and link colors. Button text
						must contrast with its button background.
					</p>
					<div className="admin-card">
						{colorFields(BUTTON_FIELDS, current)}
					</div>
				</section>

				<section className="mt-6">
					<h2 className="admin-section-title">Gradients</h2>
					<p className="text-xs text-[var(--admin-text-muted)] mb-2">
						Card header and hero section gradient. These blend from start → end
						across headings and banners.
					</p>
					<div className="admin-card">
						{colorFields(GRADIENT_FIELDS, current)}
					</div>
				</section>

				<h2 className="mt-8 text-lg font-extrabold">🛠 Admin panel (HK)</h2>
				<p className="text-xs text-[var(--admin-text-muted)] mb-3 mt-1">
					Override colors for the Housekeeping admin panel. These apply across
					both light and dark modes. Leave empty to use auto-derived defaults.
				</p>
				<section className="mt-4">
					<div className="admin-card">{colorFields(ADMIN_FIELDS, current)}</div>
				</section>

				<h2 className="mt-8 text-lg font-extrabold">🌙 Dark mode</h2>
				<p className="text-xs text-[var(--admin-text-muted)] mb-3 mt-1">
					These colors are used when visitors switch to dark mode. Dark
					backgrounds need lighter text for good contrast.
				</p>
				<section className="mt-4">
					<h3 className="admin-section-title">Page &amp; text colors</h3>
					<div className="admin-card">
						{colorFields(COLOR_FIELDS, currentDark, "_dark")}
					</div>
				</section>
				<section className="mt-6">
					<h3 className="admin-section-title">Buttons &amp; links</h3>
					<div className="admin-card">
						{colorFields(BUTTON_FIELDS, currentDark, "_dark")}
					</div>
				</section>
				<section className="mt-6">
					<h3 className="admin-section-title">Gradients</h3>
					<div className="admin-card">
						{colorFields(GRADIENT_FIELDS, currentDark, "_dark")}
					</div>
				</section>

				<section className="mt-6">
					<h2 className="admin-section-title">{t("typographyLayout")}</h2>
					<div className="admin-card">
						<div className="flex flex-wrap gap-5 items-center">
							<label className="flex items-center gap-2">
								<span className="text-sm">{t("font")}</span>
								<select name="font_family" defaultValue={fontKey}>
									{Object.entries(FONTS).map(([key, f]) => (
										<option key={key} value={key}>
											{f.label}
										</option>
									))}
								</select>
							</label>
							{HEADINGS.map((h) => (
								<label key={h.key} className="flex items-center gap-2">
									<span className="text-sm">{h.label} (px)</span>
									<input
										name={h.key}
										type="number"
										min={10}
										max={80}
										defaultValue={
											/^\d{1,3}$/.test(headings[h.key])
												? headings[h.key]
												: h.def
										}
										className="w-20"
									/>
								</label>
							))}
							<label className="flex items-center gap-2">
								<span className="text-sm">{t("borderRadius")}</span>
								<input
									name="border_radius"
									type="number"
									min={0}
									max={40}
									defaultValue={/^\d{1,3}$/.test(radius) ? radius : "12"}
									className="w-20"
								/>
							</label>
						</div>
					</div>
				</section>

				<section className="mt-6">
					<h2 className="admin-section-title">{t("cssTitle")}</h2>
					<p className="text-xs text-[var(--admin-text-muted)] mb-2">
						{t("cssSubtitle")}
					</p>
					<textarea
						name="custom_css"
						defaultValue={customCss}
						rows={8}
						spellCheck={false}
						placeholder={t("cssPlaceholder")}
						className="w-full font-mono text-sm"
					/>
					<div className="mt-4 text-right">
						<Button type="submit" variant="default">
							{t("saveCss")}
						</Button>
					</div>
				</section>
			</form>
		</main>
	);
}
