"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/admin/guard";
import { db, ThemeScope, ThemeScopeValue } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { logStaffActivity } from "@/lib/services/staff-activity";
import {
	BLOCK_KEY_PREFIX,
	EFFECT_KEYS,
	LAYOUT_KEYS,
	MEDIA_KEYS,
	THEME_BLOCKS,
} from "@/lib/theme-blocks";
import { allModuleIds } from "@/lib/theme-modules";
import { THEME_COLOR_KEYS } from "@/lib/theme-presets";
import { getAllScopes, getScopeValues } from "@/lib/theme-resolver";

const COLOR_RE = /^[#a-zA-Z0-9(),.\s%-]+$/;

// ─── Scope CRUD ──────────────────────────────────────────────────────────────

export async function createScope(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);

	const name = String(formData.get("name") ?? "").trim();
	const type = String(formData.get("type") ?? "") as
		| "global"
		| "site"
		| "module"
		| "route";
	const parentId = formData.get("parent_id")
		? Number(formData.get("parent_id"))
		: null;
	const siteDomain = String(formData.get("site_domain") ?? "").trim() || null;
	const routePath = String(formData.get("route_path") ?? "").trim() || null;
	const moduleId = String(formData.get("module_id") ?? "").trim() || null;

	if (!name || !type) redirect("/admin/theme-builder");

	if (type === "module" && !moduleId) redirect("/admin/theme-builder");
	if (type === "route" && !routePath) redirect("/admin/theme-builder");
	if (type === "site" && !siteDomain) redirect("/admin/theme-builder");

	const [maxRow] = await db
		.select({ maxSort: sql<number>`COALESCE(MAX(${ThemeScope.sortOrder}), 0)` })
		.from(ThemeScope);

	try {
		await db.insert(ThemeScope).values({
			name,
			type,
			parentId: parentId ? BigInt(parentId) : null,
			siteDomain,
			routePath,
			moduleId,
			isActive: true,
			sortOrder: (maxRow?.maxSort ?? 0) + 1,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		const staff = await requirePermission(PERMS.SETTINGS_EDIT);
		await logStaffActivity({
			staffId: staff.id,
			action: "theme_scope_create",
			description: `Created theme scope "${name}" (${type})`,
		});

		revalidatePath("/admin/theme-builder");
	} catch {
		// ignore
	}
	redirect("/admin/theme-builder?created=1");
}

export async function updateScope(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);

	const id = Number(formData.get("id"));
	const name = String(formData.get("name") ?? "").trim();
	const isActive = formData.get("is_active") === "on";

	if (!id) redirect("/admin/theme-builder");

	try {
		await db
			.update(ThemeScope)
			.set({ name, isActive, updatedAt: new Date() })
			.where(sql`${ThemeScope.id} = ${id}`);

		revalidatePath("/admin/theme-builder");
	} catch {
		// ignore
	}
	redirect("/admin/theme-builder?updated=1");
}

export async function deleteScope(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);

	const id = Number(formData.get("id"));
	if (!id) redirect("/admin/theme-builder");

	try {
		await db
			.delete(ThemeScopeValue)
			.where(sql`${ThemeScopeValue.scopeId} = ${id}`);
		await db.delete(ThemeScope).where(sql`${ThemeScope.id} = ${id}`);

		const staff = await requirePermission(PERMS.SETTINGS_EDIT);
		await logStaffActivity({
			staffId: staff.id,
			action: "theme_scope_delete",
			description: `Deleted theme scope #${id}`,
		});

		revalidatePath("/admin/theme-builder");
	} catch {
		// ignore
	}
	redirect("/admin/theme-builder?deleted=1");
}

export async function reorderScopes(orderedIds: number[]): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);

	try {
		for (let i = 0; i < orderedIds.length; i++) {
			await db
				.update(ThemeScope)
				.set({ sortOrder: i, updatedAt: new Date() })
				.where(sql`${ThemeScope.id} = ${orderedIds[i]}`);
		}
		revalidatePath("/admin/theme-builder");
	} catch {
		// ignore
	}
}

// ─── Theme Values CRUD ───────────────────────────────────────────────────────

export async function saveScopeValues(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);

	const scopeId = Number(formData.get("scope_id"));
	if (!scopeId) redirect("/admin/theme-builder");

	try {
		// Save color values (light + dark)
		for (const mode of ["light", "dark"] as const) {
			for (const key of THEME_COLOR_KEYS) {
				const fieldKey = `${key}_${mode}`;
				const raw = String(formData.get(fieldKey) ?? "").trim();
				if (!raw || !COLOR_RE.test(raw)) continue;

				await db
					.insert(ThemeScopeValue)
					.values({
						scopeId: BigInt(scopeId),
						settingKey: key,
						settingVal: raw,
						mode,
						createdAt: new Date(),
						updatedAt: new Date(),
					})
					.onDuplicateKeyUpdate({
						set: { settingVal: raw, updatedAt: new Date() },
					});
			}
		}

		// Save block visibility
		for (const block of THEME_BLOCKS) {
			const key = `${BLOCK_KEY_PREFIX}${block.id}`;
			const val = formData.get(key);
			const visible = val === "on" || val === "true" ? "true" : "false";

			// Only save if different from default
			if (visible !== String(block.defaultVisible)) {
				await db
					.insert(ThemeScopeValue)
					.values({
						scopeId: BigInt(scopeId),
						settingKey: key,
						settingVal: visible,
						mode: "light",
						createdAt: new Date(),
						updatedAt: new Date(),
					})
					.onDuplicateKeyUpdate({
						set: { settingVal: visible, updatedAt: new Date() },
					});
			} else {
				// Remove if set back to default
				await db
					.delete(ThemeScopeValue)
					.where(
						and(
							sql`${ThemeScopeValue.scopeId} = ${scopeId}`,
							eq(ThemeScopeValue.settingKey, key),
						),
					);
			}
		}

		// Save layout settings
		for (const key of LAYOUT_KEYS) {
			const raw = String(formData.get(key) ?? "").trim();
			if (!raw) continue;

			await db
				.insert(ThemeScopeValue)
				.values({
					scopeId: BigInt(scopeId),
					settingKey: key,
					settingVal: raw,
					mode: "light",
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.onDuplicateKeyUpdate({
					set: { settingVal: raw, updatedAt: new Date() },
				});
		}

		// Save effect settings
		for (const key of EFFECT_KEYS) {
			const raw = String(formData.get(key) ?? "").trim();
			if (!raw) continue;

			await db
				.insert(ThemeScopeValue)
				.values({
					scopeId: BigInt(scopeId),
					settingKey: key,
					settingVal: raw,
					mode: "light",
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.onDuplicateKeyUpdate({
					set: { settingVal: raw, updatedAt: new Date() },
				});
		}

		// Save media settings
		for (const key of MEDIA_KEYS) {
			const raw = String(formData.get(key) ?? "").trim();
			if (!raw) continue;

			await db
				.insert(ThemeScopeValue)
				.values({
					scopeId: BigInt(scopeId),
					settingKey: key,
					settingVal: raw,
					mode: "light",
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.onDuplicateKeyUpdate({
					set: { settingVal: raw, updatedAt: new Date() },
				});
		}

		// Save custom CSS
		const customCss = String(formData.get("custom:css") ?? "").trim();
		if (customCss) {
			await db
				.insert(ThemeScopeValue)
				.values({
					scopeId: BigInt(scopeId),
					settingKey: "custom:css",
					settingVal: customCss,
					mode: "light",
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.onDuplicateKeyUpdate({
					set: { settingVal: customCss, updatedAt: new Date() },
				});
		} else {
			await db
				.delete(ThemeScopeValue)
				.where(
					and(
						sql`${ThemeScopeValue.scopeId} = ${scopeId}`,
						eq(ThemeScopeValue.settingKey, "custom:css"),
					),
				);
		}

		// Save custom HTML
		const customHtml = String(formData.get("custom:html") ?? "").trim();
		if (customHtml) {
			await db
				.insert(ThemeScopeValue)
				.values({
					scopeId: BigInt(scopeId),
					settingKey: "custom:html",
					settingVal: customHtml,
					mode: "light",
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.onDuplicateKeyUpdate({
					set: { settingVal: customHtml, updatedAt: new Date() },
				});
		} else {
			await db
				.delete(ThemeScopeValue)
				.where(
					and(
						sql`${ThemeScopeValue.scopeId} = ${scopeId}`,
						eq(ThemeScopeValue.settingKey, "custom:html"),
					),
				);
		}

		const staff = await requirePermission(PERMS.SETTINGS_EDIT);
		await logStaffActivity({
			staffId: staff.id,
			action: "theme_scope_values",
			description: `Updated theme values for scope #${scopeId}`,
		});

		revalidatePath("/admin/theme-builder");
		revalidatePath("/", "layout");
	} catch {
		// ignore
	}
	redirect("/admin/theme-builder?saved=1");
}

export async function resetScopeValues(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);

	const scopeId = Number(formData.get("scope_id"));
	const key = String(formData.get("key") ?? "");
	const mode = String(formData.get("mode") ?? "") as "light" | "dark";

	if (!scopeId || !key) redirect("/admin/theme-builder");

	try {
		await db
			.delete(ThemeScopeValue)
			.where(
				and(
					sql`${ThemeScopeValue.scopeId} = ${scopeId}`,
					eq(ThemeScopeValue.settingKey, key),
					eq(ThemeScopeValue.mode, mode),
				),
			);

		revalidatePath("/admin/theme-builder");
	} catch {
		// ignore
	}
	redirect("/admin/theme-builder?reset=1");
}

// ─── Duplicate scope ─────────────────────────────────────────────────────────

export async function duplicateScope(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);

	const sourceId = Number(formData.get("id"));
	if (!sourceId) redirect("/admin/theme-builder");

	try {
		const scopes = await getAllScopes();
		const source = scopes.find((s) => s.id === sourceId);
		if (!source) redirect("/admin/theme-builder");

		const [maxRow] = await db
			.select({
				maxSort: sql<number>`COALESCE(MAX(${ThemeScope.sortOrder}), 0)`,
			})
			.from(ThemeScope);

		await db.insert(ThemeScope).values({
			name: `${source.name} (copy)`,
			type: source.type,
			parentId: source.parentId ? BigInt(source.parentId) : null,
			siteDomain: source.siteDomain,
			routePath: source.routePath,
			moduleId: source.moduleId,
			isActive: false,
			sortOrder: (maxRow?.maxSort ?? 0) + 1,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		const sourceValues = await getScopeValues(sourceId);
		const allScopes = await getAllScopes();
		const newScope = allScopes.find((s) => s.name === `${source.name} (copy)`);

		if (newScope) {
			for (const [key, val] of Object.entries(sourceValues)) {
				if (val.light) {
					await db.insert(ThemeScopeValue).values({
						scopeId: BigInt(newScope.id),
						settingKey: key,
						settingVal: val.light,
						mode: "light",
						createdAt: new Date(),
						updatedAt: new Date(),
					});
				}
				if (val.dark) {
					await db.insert(ThemeScopeValue).values({
						scopeId: BigInt(newScope.id),
						settingKey: key,
						settingVal: val.dark,
						mode: "dark",
						createdAt: new Date(),
						updatedAt: new Date(),
					});
				}
			}
		}

		revalidatePath("/admin/theme-builder");
	} catch {
		// ignore
	}
	redirect("/admin/theme-builder?duplicated=1");
}

// ─── Data helpers for the admin page ─────────────────────────────────────────

export async function getThemeBuilderData() {
	// Exported from a "use server" file, so it is a public endpoint too (the page needs SETTINGS_VIEW).
	await requirePermission(PERMS.SETTINGS_VIEW);
	const scopes = await getAllScopes();
	const moduleIds = allModuleIds();
	const tree = buildTree(scopes);

	return { scopes, tree, moduleIds };
}

type ScopeNode = Awaited<ReturnType<typeof getAllScopes>>[number] & {
	children: ScopeNode[];
};

function buildTree(
	scopes: Awaited<ReturnType<typeof getAllScopes>>,
): ScopeNode[] {
	const nodeMap = new Map<number, ScopeNode>();
	const roots: ScopeNode[] = [];

	for (const scope of scopes) {
		nodeMap.set(scope.id, { ...scope, children: [] });
	}

	for (const scope of scopes) {
		const node = nodeMap.get(scope.id);
		if (!node) continue;
		if (scope.parentId) {
			const parent = nodeMap.get(scope.parentId);
			if (parent) {
				parent.children.push(node);
			} else {
				roots.push(node);
			}
		} else {
			roots.push(node);
		}
	}

	return roots;
}
