import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

const AdminMediaGrid = dynamic(
	() =>
		import("@/components/admin/media-grid").then((m) => ({
			default: m.AdminMediaGrid,
		})),
	{
		loading: () => (
			<div className="animate-pulse bg-[var(--admin-surface)] rounded h-48" />
		),
	},
);

export default async function AdminMediaPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PAGES_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	return (
		<main>
			<AdminMediaGrid />
		</main>
	);
}
