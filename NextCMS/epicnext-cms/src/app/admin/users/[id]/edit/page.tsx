import { redirect } from "next/navigation";

/**
 * Legacy URL — the canonical edit UI lives at /admin/users/edit/[id]
 * and is gated by PERMS.USERS_EDIT.
 */
export default async function AdminUserEditRedirect({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	redirect(`/admin/users/edit/${id}`);
}
