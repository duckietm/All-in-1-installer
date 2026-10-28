import { DoorOpen, Eye } from "lucide-react";
import { redirect } from "next/navigation";
import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { loadRoom } from "../../_lib/load-room";
import { RoomEditForm } from "../../[id]/room-edit-form";

export default async function RoomEditPage({
	params,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const { id } = await params;
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ROOMS_EDIT, session.user.rank)) {
		redirect("/admin");
	}

	const room = await loadRoom(id);

	return (
		<div className="space-y-6">
			<AdminBreadcrumb
				items={[
					{ label: "Rooms", href: "/admin/rooms" },
					{ label: room.name, href: `/admin/rooms/show/${room.id}` },
					{ label: "Edit" },
				]}
			/>

			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<DoorOpen className="h-6 w-6 text-muted-foreground" />
					<div>
						<h1 className="text-2xl font-bold flex items-center gap-2">
							Edit: {room.name}
							<Badge variant="secondary" className="text-xs">
								#{room.id}
							</Badge>
						</h1>
						<p className="text-sm text-muted-foreground">
							Owner: {room.owner?.username ?? room.ownerName} &middot;{" "}
							{room.users}/{room.usersMax} users
						</p>
					</div>
				</div>
				<Button variant="outline" asChild>
					<Link href={`/admin/rooms/show/${room.id}`}>
						<Eye className="mr-2 h-4 w-4" /> View
					</Link>
				</Button>
			</div>

			<RoomEditForm
				room={{
					id: room.id,
					name: room.name,
					description: room.description,
					state: room.state,
					usersMax: room.usersMax,
					users: room.users,
					ownerName: room.owner?.username ?? room.ownerName,
				}}
			/>
		</div>
	);
}
