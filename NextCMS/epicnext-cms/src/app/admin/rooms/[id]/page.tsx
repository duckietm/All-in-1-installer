import { redirect } from "next/navigation";

export default async function RoomLegacyPage({
	params,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const { id } = await params;
	redirect(`/admin/rooms/show/${id}`);
}
