import { redirect } from "next/navigation";

/** Legacy route — redirects to /admin/users/show/[id] */
export default async function UserLegacyPage({
	params,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const { id } = await params;
	redirect(`/admin/users/show/${id}`);
}
