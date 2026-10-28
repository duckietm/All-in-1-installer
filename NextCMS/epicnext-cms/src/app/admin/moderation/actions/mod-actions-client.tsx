"use client";

import {
	DoorOpen,
	Loader2,
	Megaphone,
	MessageSquare,
	Shield,
	Volume2,
	VolumeX,
	Zap,
} from "lucide-react";
import { useState } from "react";
import {
	broadcastAlert,
	quickAlert,
	quickKick,
	quickMute,
	quickRoomKick,
	quickUnmute,
} from "@/actions/moderation";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";

export function ModActionsClient() {
	const { run, isPending } = useServerAction();
	const { confirm, dialog: confirmDialog } = useConfirmDialog();

	const [userId, setUserId] = useState("");
	const [muteDuration, setMuteDuration] = useState("10");
	const [alertMessage, setAlertMessage] = useState("");
	const [roomId, setRoomId] = useState("");
	const [broadcastMsg, setBroadcastMsg] = useState("");

	const uid = parseInt(userId, 10);
	const rid = parseInt(roomId, 10);

	async function handleKick() {
		const ok = await confirm({
			title: "Kick user",
			description: `Disconnect user #${uid}?`,
			confirmLabel: "Kick",
		});
		if (!ok) return;
		run(() => quickKick({ userId: uid }), {
			successMessage: "User disconnected",
		});
	}

	async function handleRoomKick() {
		const ok = await confirm({
			title: "Kick all from room",
			description: `Kick every user from room #${rid}?`,
			confirmLabel: "Kick all",
		});
		if (!ok) return;
		run(() => quickRoomKick({ roomId: rid }), {
			successMessage: "All users kicked from room",
		});
	}

	async function handleHotelBroadcast() {
		const ok = await confirm({
			title: "Hotel-wide alert",
			description: "Send this alert to everyone in the hotel?",
			confirmLabel: "Send",
			variant: "default",
		});
		if (!ok) return;
		run(
			() =>
				broadcastAlert({
					message: broadcastMsg.trim(),
					type: "hotel",
				}),
			{
				successMessage: "Hotel alert sent!",
				onSuccess: () => setBroadcastMsg(""),
			},
		);
	}

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			{confirmDialog}
			<Card>
				<CardHeader>
					<CardTitle className="text-sm flex items-center gap-2">
						<Zap className="h-4 w-4 text-[var(--admin-warning)]" />
						User Actions
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div>
						<span className="text-xs text-muted-foreground mb-1 block">
							User ID
						</span>
						<Input
							type="number"
							value={userId}
							onChange={(e) => setUserId(e.target.value)}
							placeholder="Enter user ID"
							aria-label="User ID"
						/>
					</div>

					<div className="grid grid-cols-2 gap-2">
						<Button
							variant="destructive"
							size="sm"
							disabled={isPending || !uid}
							onClick={handleKick}
						>
							{isPending ? (
								<Loader2 className="mr-1 h-3 w-3 animate-spin" />
							) : (
								<Zap className="mr-1 h-3 w-3" />
							)}
							Kick / Disconnect
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={isPending || !uid}
							onClick={() =>
								run(() => quickUnmute({ userId: uid }), {
									successMessage: "User unmuted",
								})
							}
						>
							<Volume2 className="mr-1 h-3 w-3" /> Unmute
						</Button>
					</div>

					<div className="flex gap-2">
						<Input
							type="number"
							min={1}
							max={1440}
							value={muteDuration}
							onChange={(e) => setMuteDuration(e.target.value)}
							className="w-24"
							placeholder="Min"
							aria-label="Mute duration in minutes"
						/>
						<Button
							variant="outline"
							size="sm"
							className="flex-1"
							disabled={isPending || !uid || !parseInt(muteDuration, 10)}
							onClick={() =>
								run(
									() =>
										quickMute({
											userId: uid,
											duration: parseInt(muteDuration, 10),
										}),
									{
										successMessage: `Muted for ${muteDuration} min`,
									},
								)
							}
						>
							<VolumeX className="mr-1 h-3 w-3" /> Mute
						</Button>
					</div>

					<div className="flex gap-2">
						<Textarea
							value={alertMessage}
							onChange={(e) => setAlertMessage(e.target.value)}
							placeholder="Alert message to user..."
							rows={2}
							className="resize-none text-xs"
						/>
						<Button
							variant="outline"
							size="sm"
							className="shrink-0 h-auto"
							disabled={isPending || !uid || !alertMessage.trim()}
							onClick={() => {
								run(
									() =>
										quickAlert({ userId: uid, message: alertMessage.trim() }),
									{
										successMessage: "Alert sent",
										onSuccess: () => setAlertMessage(""),
									},
								);
							}}
						>
							<MessageSquare className="h-4 w-4" />
						</Button>
					</div>
				</CardContent>
			</Card>

			<div className="space-y-6">
				<Card>
					<CardHeader>
						<CardTitle className="text-sm flex items-center gap-2">
							<DoorOpen className="h-4 w-4 text-[var(--admin-warning)]" />
							Room Actions
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div>
							<span className="text-xs text-muted-foreground mb-1 block">
								Room ID
							</span>
							<Input
								type="number"
								value={roomId}
								onChange={(e) => setRoomId(e.target.value)}
								placeholder="Enter room ID"
								aria-label="Room ID"
							/>
						</div>
						<Button
							variant="destructive"
							size="sm"
							className="w-full"
							disabled={isPending || !rid}
							onClick={handleRoomKick}
						>
							<Zap className="mr-1 h-3 w-3" /> Kick All From Room
						</Button>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-sm flex items-center gap-2">
							<Megaphone className="h-4 w-4 text-primary" />
							Broadcast Alert
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<Textarea
							value={broadcastMsg}
							onChange={(e) => setBroadcastMsg(e.target.value)}
							placeholder="Type broadcast message..."
							rows={3}
							className="resize-none"
						/>
						<div className="grid grid-cols-2 gap-2">
							<Button
								size="sm"
								disabled={isPending || !broadcastMsg.trim()}
								onClick={handleHotelBroadcast}
							>
								<Megaphone className="mr-1 h-3 w-3" /> Hotel Alert
							</Button>
							<Button
								variant="secondary"
								size="sm"
								disabled={isPending || !broadcastMsg.trim()}
								onClick={() => {
									run(
										() =>
											broadcastAlert({
												message: broadcastMsg.trim(),
												type: "staff",
											}),
										{
											successMessage: "Staff alert sent!",
											onSuccess: () => setBroadcastMsg(""),
										},
									);
								}}
							>
								<Shield className="mr-1 h-3 w-3" /> Staff Alert
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
