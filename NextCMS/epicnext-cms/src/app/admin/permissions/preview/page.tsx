import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { isDynamicSuperAdmin } from "@/lib/admin/authorization-policy";
import { previewRoleAccess } from "@/lib/admin/permission-preview";
import { queryRows } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function PermissionPreview({
	searchParams,
}: {
	searchParams: Promise<{ role?: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PERMISSIONS_MANAGE, session.user.rank))
		redirect("/admin");
	const t = await getTranslations("pages.admin.permissionPreview");
	const nav = await getTranslations("pages.admin.nav");
	const roles = await queryRows<{
		id: number;
		slug: string;
		title: string;
	}>(sql`SELECT id, slug, title FROM acl_roles ORDER BY title, id`);
	const params = await searchParams;
	const selected =
		roles.find((r) => String(r.id) === params.role) ??
		(params.role ? undefined : roles[0]);
	let preview: ReturnType<typeof previewRoleAccess> | undefined;
	let superAdmin = false;
	let permissionTitles: Record<string, string> = {};
	if (selected) {
		const grants = await queryRows<{ slug: string; title: string }>(
			sql`SELECT p.slug, p.title FROM acl_model_permissions mp JOIN acl_permissions p ON p.id = mp.permission_id WHERE mp.model_type = 'Role' AND mp.model_id = ${selected.id}`,
		);
		const highest = (
			await queryRows<{ highest_rank: number | null }>(
				sql`SELECT COALESCE((SELECT MAX(u.\`rank\`) FROM users u INNER JOIN permission_ranks pr ON pr.id = u.\`rank\`), (SELECT MAX(id) FROM permission_ranks)) AS highest_rank`,
			)
		)[0]?.highest_rank;
		const rankMatch = /^rank_([1-9]\d*)$/.exec(selected.slug);
		superAdmin =
			!!rankMatch &&
			isDynamicSuperAdmin(
				Number(rankMatch[1]),
				highest == null ? null : Number(highest),
			);
		preview = previewRoleAccess(
			grants.map((g) => g.slug),
			superAdmin,
		);
		const allRows = await queryRows<{ slug: string; title: string }>(
			sql`SELECT slug, title FROM acl_permissions ORDER BY slug`,
		);
		permissionTitles = Object.fromEntries(
			allRows.map((p) => [p.slug, p.title]),
		);
	}
	return (
		<div className="space-y-5">
			<div>
				<h1 className="text-2xl font-semibold">{t("title")}</h1>
				<p className="text-muted-foreground">{t("description")}</p>
			</div>
			<Link className="btn btn-outline" href="/admin/permissions">
				{t("back")}
			</Link>
			<form className="admin-card flex flex-wrap items-end gap-3">
				<label className="grid min-w-0 max-w-full flex-1 gap-1 text-sm">
					{t("role")}
					<select
						name="role"
						defaultValue={selected?.id ?? ""}
						className="input w-full min-w-0 max-w-full"
					>
						{roles.map((role) => (
							<option key={role.id} value={role.id}>
								{role.title} ({role.slug})
							</option>
						))}
					</select>
				</label>
				<button
					className="btn btn-primary"
					type="submit"
					disabled={!roles.length}
				>
					{t("show")}
				</button>
			</form>
			{!preview ? (
				<p role="status">{t("missing")}</p>
			) : (
				<>
					<div className="admin-card space-y-2">
						<p className="font-semibold">
							{t(preview.canEnter ? "entryAllowed" : "entryDenied")}
						</p>
						{superAdmin && <p>{t("superAdmin")}</p>}
						<p className="text-sm text-muted-foreground">{t("scope")}</p>
					</div>
					<section className="admin-card">
						<h2 className="mb-3 font-semibold">{t("sections")}</h2>
						<div className="grid gap-2 sm:grid-cols-2">
							{preview.sections.map((item) => (
								<div key={item.href} className="min-w-0 rounded border p-3">
									<div className="flex justify-between gap-2">
										<span>{nav(item.labelKey)}</span>
										<span className="text-xs">
											{t(item.allowed ? "allowed" : "denied")}
										</span>
									</div>
									<p className="break-all text-xs text-muted-foreground">
										{item.href}
									</p>
								</div>
							))}
						</div>
					</section>
					<details className="admin-card">
						<summary className="cursor-pointer font-semibold">
							{t("actions")}
						</summary>
						<p className="my-3 text-sm text-muted-foreground">
							{t("actionScope")}
						</p>
						<ul className="divide-y">
							{preview.actions.map((item) => (
								<li
									key={item.slug}
									className="flex items-start justify-between gap-3 py-2"
								>
									<div className="min-w-0">
										<p className="break-words">
											{permissionTitles[item.slug] || item.slug}
										</p>
										<code className="break-all text-xs text-muted-foreground">
											{item.slug}
										</code>
									</div>
									<span className="shrink-0 text-xs">
										{t(item.granted ? "granted" : "notGranted")}
									</span>
								</li>
							))}
						</ul>
					</details>
				</>
			)}
		</div>
	);
}
