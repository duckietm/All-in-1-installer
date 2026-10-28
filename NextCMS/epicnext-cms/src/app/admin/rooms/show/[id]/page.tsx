import { DoorOpen, Eye, Globe, Lock, Pencil, Sofa, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { loadRoom } from "../../_lib/load-room";

const stateVariants: Record<
	string,
	"default" | "secondary" | "destructive" | "outline"
> = {
	open: "default",
	locked: "secondary",
	password: "destructive",
	invisible: "outline",
};

export default async function RoomShowPage({
	params,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const { id } = await params;
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ROOMS_VIEW, session.user.rank))
		redirect("/admin");

	const room = await loadRoom(id);
	const canEdit = canAccess(permissions, PERMS.ROOMS_EDIT, session.user.rank);

	return (
		<div className="space-y-6">
			<AdminBreadcrumb
				items={[{ label: "Rooms", href: "/admin/rooms" }, { label: room.name }]}
			/>

			{/* Hero */}
			<div className="rounded-xl border bg-gradient-to-r from-card to-muted/30 p-6">
				<div className="flex items-start justify-between gap-4">
					<div className="space-y-2">
						<div className="flex items-center gap-2">
							<DoorOpen className="h-6 w-6 text-muted-foreground" />
							<h1 className="text-2xl font-bold">{room.name}</h1>
							<Badge variant="secondary" className="text-xs">
								#{room.id}
							</Badge>
							<Badge variant={stateVariants[room.state] || "outline"}>
								{room.state}
							</Badge>
						</div>
						{room.description && (
							<p className="text-muted-foreground">{room.description}</p>
						)}
						<div className="flex items-center gap-4 text-sm">
							<span className="flex items-center gap-1.5">
								<Users className="h-4 w-4 text-muted-foreground" />
								<span className="font-medium">{room.users}</span> /{" "}
								{room.usersMax} users
							</span>
							{room.owner ? (
								<Link
									href={`/admin/users/show/${room.owner.id}`}
									className="text-primary hover:underline"
								>
									Owner: {room.owner.username}
								</Link>
							) : (
								<span>Owner: {room.ownerName}</span>
							)}
						</div>
					</div>
					<div className="flex gap-2">
						<Button variant="outline" asChild>
							<Link href={`/admin/rooms/${room.id}/furni`}>
								<Sofa className="mr-2 h-4 w-4" /> Furniture
							</Link>
						</Button>
						{canEdit && (
							<Button asChild>
								<Link href={`/admin/rooms/edit/${room.id}`}>
									<Pencil className="mr-2 h-4 w-4" /> Edit
								</Link>
							</Button>
						)}
					</div>
				</div>
			</div>

			{/* Info grid */}
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardContent className="pt-6">
						<div className="flex items-center gap-3">
							<Users className="h-5 w-5 text-muted-foreground" />
							<div>
								<p className="text-2xl font-bold">
									{room.users} / {room.usersMax}
								</p>
								<p className="text-xs text-muted-foreground">Current Users</p>
							</div>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="pt-6">
						<div className="flex items-center gap-3">
							<Lock className="h-5 w-5 text-muted-foreground" />
							<div>
								<p className="text-2xl font-bold capitalize">{room.state}</p>
								<p className="text-xs text-muted-foreground">Access State</p>
							</div>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="pt-6">
						<div className="flex items-center gap-3">
							<Eye className="h-5 w-5 text-muted-foreground" />
							<div>
								<p className="text-2xl font-bold">{room.score}</p>
								<p className="text-xs text-muted-foreground">Score</p>
							</div>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="pt-6">
						<div className="flex items-center gap-3">
							<Globe className="h-5 w-5 text-muted-foreground" />
							<div>
								<p className="text-2xl font-bold truncate">{room.category}</p>
								<p className="text-xs text-muted-foreground">Category</p>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
