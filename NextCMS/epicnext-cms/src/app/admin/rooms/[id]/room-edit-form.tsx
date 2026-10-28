"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	Loader2,
	Lock,
	LogOut,
	RefreshCw,
	Save,
	Trash2,
	Unlock,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { deleteRoom, roomRconAction, updateRoom } from "@/actions/rooms";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import { type UpdateRoomInput, updateRoomSchema } from "@/lib/validators/room";

interface RoomEditFormProps {
	room: {
		id: number;
		name: string;
		description: string;
		state: string;
		usersMax: number;
		users: number;
		ownerName: string;
	};
}

export function RoomEditForm({ room }: RoomEditFormProps) {
	const { run, isPending } = useServerAction();
	const {
		register,
		handleSubmit,
		setValue,
		formState: { errors },
	} = useForm<UpdateRoomInput>({
		resolver: zodResolver(updateRoomSchema),
		defaultValues: {
			name: room.name,
			description: room.description,
			state: room.state as "open" | "locked" | "password" | "invisible",
			usersMax: room.usersMax,
		},
	});

	function onSubmit(data: UpdateRoomInput) {
		run(() => updateRoom({ id: room.id, ...data }), {
			successMessage: "Room updated successfully.",
		});
	}

	const { confirm, dialog: confirmDialog } = useConfirmDialog();

	async function handleDelete() {
		const ok = await confirm({
			title: "Delete Room",
			description:
				"Are you sure you want to delete this room? This cannot be undone.",
			confirmLabel: "Delete",
			variant: "danger",
		});
		if (!ok) return;
		run(() => deleteRoom({ id: room.id }), { redirectTo: "/admin/rooms" });
	}

	function handleRconAction(action: "kick" | "lock" | "unlock" | "reload") {
		run(() => roomRconAction({ roomId: room.id, action }), {
			successMessage: `Action "${action}" executed successfully.`,
			errorMessage: `Action "${action}" failed. Is the emulator running?`,
		});
	}

	return (
		<div className="space-y-4">
			{confirmDialog}
			<div className="grid gap-6 lg:grid-cols-2">
				{/* Edit Form */}
				<Card>
					<CardHeader>
						<CardTitle>Room Details</CardTitle>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="name">Name</Label>
								<Input id="name" {...register("name")} />
								{errors.name && (
									<p className="text-sm text-destructive">
										{errors.name.message}
									</p>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="description">Description</Label>
								<Textarea
									id="description"
									rows={3}
									{...register("description")}
								/>
							</div>

							<div className="grid gap-4 sm:grid-cols-2">
								<div className="space-y-2">
									<Label>State</Label>
									<Select
										defaultValue={room.state}
										onValueChange={(v) =>
											setValue(
												"state",
												v as "open" | "locked" | "password" | "invisible",
											)
										}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="open">Open</SelectItem>
											<SelectItem value="locked">Locked</SelectItem>
											<SelectItem value="password">Password</SelectItem>
											<SelectItem value="invisible">Invisible</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label htmlFor="usersMax">Max Users</Label>
									<Input
										id="usersMax"
										type="number"
										{...register("usersMax", { valueAsNumber: true })}
									/>
								</div>
							</div>

							<div className="flex items-center gap-3">
								<Button type="submit" disabled={isPending}>
									{isPending ? (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									) : (
										<Save className="mr-2 h-4 w-4" />
									)}
									Save Changes
								</Button>
								<Button
									type="button"
									variant="destructive"
									onClick={handleDelete}
									disabled={isPending}
								>
									<Trash2 className="mr-2 h-4 w-4" />
									Delete Room
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>

				{/* RCON Actions */}
				<Card>
					<CardHeader>
						<CardTitle>Quick Actions</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">Owner</span>
							<span className="font-medium">{room.ownerName}</span>
						</div>
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">Current Users</span>
							<Badge>
								{room.users} / {room.usersMax}
							</Badge>
						</div>
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">State</span>
							<Badge
								variant={
									room.state === "open"
										? "default"
										: room.state === "locked"
											? "secondary"
											: "destructive"
								}
							>
								{room.state}
							</Badge>
						</div>

						<div className="border-t pt-4 space-y-2">
							<p className="text-sm font-medium">RCON Commands</p>
							<div className="grid grid-cols-2 gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => handleRconAction("kick")}
									disabled={isPending}
								>
									<LogOut className="mr-2 h-4 w-4" />
									Kick All
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => handleRconAction("lock")}
									disabled={isPending}
								>
									<Lock className="mr-2 h-4 w-4" />
									Lock
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => handleRconAction("unlock")}
									disabled={isPending}
								>
									<Unlock className="mr-2 h-4 w-4" />
									Unlock
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => handleRconAction("reload")}
									disabled={isPending}
								>
									<RefreshCw className="mr-2 h-4 w-4" />
									Reload
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
