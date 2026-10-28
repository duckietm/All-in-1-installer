import { redirect } from "next/navigation";
import { getThemeBuilderData } from "@/actions/theme-builder";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { getFullScopeValues } from "@/lib/theme-resolver";
import { ScopeForm } from "./scope-form";
import { ScopeTree } from "./scope-tree";
import { ThemeEditor } from "./theme-editor";

export const metadata = { title: "Theme Builder" };

export default async function ThemeBuilderPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | undefined>>;
}) {
	const ctx = await getAdminContext();
	if (!ctx || !canAccess(ctx.permissions, PERMS.SETTINGS_VIEW)) {
		redirect("/admin");
	}

	const sp = await searchParams;
	const { scopes, tree, moduleIds } = await getThemeBuilderData();

	const selectedId = sp.scope ? Number(sp.scope) : (scopes[0]?.id ?? null);

	const values = selectedId
		? await getFullScopeValues(selectedId)
		: {
				light: {},
				dark: {},
				blocks: {},
				layout: {},
				effects: {},
				media: {},
				custom: {},
			};

	return (
		<div>
			<h1 className="admin-section-title mb-4">Theme Builder</h1>
			<p className="text-xs text-[var(--admin-text-muted)] mb-6">
				Create and manage scoped themes for different parts of your site. Themes
				inherit from parent scopes — only override what you need.
			</p>

			{sp.created ? (
				<div className="mb-4 p-3 rounded-lg theme-status-success text-xs">
					Scope created.
				</div>
			) : null}
			{sp.updated ? (
				<div className="mb-4 p-3 rounded-lg theme-status-success text-xs">
					Scope updated.
				</div>
			) : null}
			{sp.deleted ? (
				<div className="mb-4 p-3 rounded-lg theme-status-success text-xs">
					Scope deleted.
				</div>
			) : null}
			{sp.saved ? (
				<div className="mb-4 p-3 rounded-lg theme-status-success text-xs">
					Theme values saved.
				</div>
			) : null}
			{sp.duplicated ? (
				<div className="mb-4 p-3 rounded-lg theme-status-success text-xs">
					Scope duplicated.
				</div>
			) : null}

			<div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
				<div className="lg:col-span-3">
					<ScopeTree tree={tree} selectedId={selectedId} />
					<div className="mt-4">
						<ScopeForm moduleIds={moduleIds} scopeCount={scopes.length} />
					</div>
				</div>

				<div className="lg:col-span-9">
					{selectedId ? (
						<ThemeEditor scopeId={selectedId} scopes={scopes} values={values} />
					) : (
						<div className="admin-card p-8 text-center text-[var(--admin-text-muted)]">
							Select or create a scope to start editing.
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
