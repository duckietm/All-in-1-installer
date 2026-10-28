import { ADMIN_NAV_GROUPS } from "../admin-nav";
import { PERMS } from "../permission-slugs";
/** Role-only simulation; never used to authorize a request. */
export function previewRoleAccess(
	slugs: readonly string[],
	superAdmin: boolean,
) {
	const grants = new Set(slugs);
	const has = (slug: string) => superAdmin || grants.has(slug);
	const canEnter = has(PERMS.ADMIN_DASHBOARD);
	return {
		canEnter,
		sections: ADMIN_NAV_GROUPS.flatMap((group) =>
			group.items.map((item) => ({
				href: item.href,
				labelKey: item.labelKey,
				required:
					typeof item.permission === "string"
						? [item.permission]
						: [...(item.permission ?? [])],
				allowed:
					canEnter &&
					(!item.permission ||
						(typeof item.permission === "string"
							? has(item.permission)
							: item.permission.some(has))),
			})),
		),
		actions: [...new Set(Object.values(PERMS))]
			.sort()
			.map((slug) => ({ slug, granted: has(slug) })),
	};
}
