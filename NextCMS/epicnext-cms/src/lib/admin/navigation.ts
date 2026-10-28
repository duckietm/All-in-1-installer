import { cache } from "react";
import { collectNavPermissionSlugs } from "@/lib/admin-nav";
import {
	ADMIN_NAV_CONFIG_KEY,
	parseAdminNavConfig,
} from "@/lib/admin-nav-config";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";

export const loadAdminNavigation = cache(async () => {
	const [{ session, permissions }, raw] = await Promise.all([
		getAdminContext(),
		siteSettings.get(ADMIN_NAV_CONFIG_KEY, ""),
	]);
	const hasDashboard = canAccess(
		permissions,
		PERMS.ADMIN_DASHBOARD,
		session.user.rank,
	);
	return {
		isSuperAdmin: permissions.isSuperAdmin,
		allowedPermissions: permissions.isSuperAdmin
			? []
			: collectNavPermissionSlugs().filter(
					(slug) =>
						canAccess(permissions, slug, session.user.rank) ||
						(hasDashboard &&
							(slug.endsWith(".view") || slug === PERMS.ADMIN_DASHBOARD)),
				),
		navConfig: parseAdminNavConfig(raw),
	};
});
