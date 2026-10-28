import { DoorOpen, Users } from "lucide-react";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface UserRoom {
	id: number;
	name: string;
	state: string;
	users: number;
	usersMax: number;
}

interface UserRoomsProps {
	rooms: UserRoom[];
}

const stateColors: Record<
	string,
	"default" | "secondary" | "outline" | "destructive"
> = {
	open: "default",
	locked: "secondary",
	password: "destructive",
	invisible: "outline",
};

export function UserRooms({ rooms }: UserRoomsProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<DoorOpen className="h-4 w-4" />
					Rooms ({rooms.length})
				</CardTitle>
			</CardHeader>
			<CardContent>
				{rooms.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						This user doesn&apos;t own any rooms.
					</p>
				) : (
					<div className="grid gap-2 sm:grid-cols-2">
						{rooms.map((room) => (
							<Link
								key={room.id}
								href={`/admin/rooms/${room.id}`}
								className="flex items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/50 transition-colors"
							>
								<div className="flex-1 min-w-0">
									<p className="text-sm font-medium truncate">{room.name}</p>
									<div className="flex items-center gap-2 mt-0.5">
										<Badge
											variant={stateColors[room.state] || "outline"}
											className="text-[10px]"
										>
											{room.state}
										</Badge>
										<span className="text-xs text-muted-foreground flex items-center gap-1">
											<Users className="h-3 w-3" />
											{room.users}/{room.usersMax}
										</span>
									</div>
								</div>
								<span className="text-xs font-mono text-muted-foreground">
									#{room.id}
								</span>
							</Link>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
