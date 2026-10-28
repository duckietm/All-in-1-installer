"use client";

import { Ban, ShieldOff } from "lucide-react";
import { useState } from "react";
import { banUser, unbanUser } from "@/actions/users";
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
import { formatDate } from "@/lib/format-date";

interface BanInfo {
	id: number;
	reason: string;
	type: string;
	staffName: string;
	timestamp: number;
	banExpire: number;
}

interface UserBanSectionProps {
	userId: number;
	username: string;
	bans: BanInfo[];
}

export function UserBanSection({
	userId,
	username,
	bans,
}: UserBanSectionProps) {
	const { isPending, run } = useServerAction();
	const [showBanForm, setShowBanForm] = useState(false);
	const [reason, setReason] = useState("");
	const [duration, setDuration] = useState("24");
	const [banType, setBanType] = useState("account");

	const activeBan = bans.find((b) => {
		const now = Math.floor(Date.now() / 1000);
		return b.banExpire === 0 || b.banExpire > now;
	});

	function handleBan() {
		run(
			() =>
				banUser({
					userId,
					reason,
					duration: parseInt(duration, 10),
					type: banType as "account" | "ip" | "machine",
				}),
			{
				successMessage: `${username} has been banned.`,
				onSuccess: () => {
					setShowBanForm(false);
					setReason("");
				},
			},
		);
	}

	function handleUnban() {
		run(() => unbanUser({ userId }), {
			successMessage: `${username} has been unbanned.`,
		});
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>Bans</CardTitle>
				<div className="flex gap-2">
					{activeBan ? (
						<Button
							variant="outline"
							size="sm"
							onClick={handleUnban}
							disabled={isPending}
						>
							<ShieldOff className="mr-2 h-4 w-4" />
							Unban
						</Button>
					) : (
						<Button
							variant="destructive"
							size="sm"
							onClick={() => setShowBanForm(!showBanForm)}
						>
							<Ban className="mr-2 h-4 w-4" />
							Ban
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{activeBan && (
					<div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
						<p className="text-sm font-medium text-destructive">Active Ban</p>
						<p className="text-sm">{activeBan.reason}</p>
						<p className="text-xs text-muted-foreground">
							By {activeBan.staffName} &middot;{" "}
							{activeBan.banExpire === 0
								? "Permanent"
								: `Expires ${formatDate(new Date(activeBan.banExpire * 1000))}`}
						</p>
					</div>
				)}

				{showBanForm && !activeBan && (
					<div className="space-y-3 rounded-md border p-3">
						<div className="space-y-2">
							<Label>Reason</Label>
							<Textarea
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								placeholder="Ban reason..."
							/>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-2">
								<Label>Duration (hours)</Label>
								<Input
									type="number"
									value={duration}
									onChange={(e) => setDuration(e.target.value)}
									placeholder="0 = permanent"
								/>
							</div>
							<div className="space-y-2">
								<Label>Type</Label>
								<Select value={banType} onValueChange={setBanType}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="account">Account</SelectItem>
										<SelectItem value="ip">IP</SelectItem>
										<SelectItem value="machine">Machine</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
						<Button
							variant="destructive"
							onClick={handleBan}
							disabled={isPending || !reason}
						>
							{isPending ? "Banning..." : "Confirm Ban"}
						</Button>
					</div>
				)}

				{bans.length > 0 && (
					<div className="space-y-2">
						<p className="text-sm font-medium">History</p>
						{bans.map((ban) => (
							<div
								key={ban.id}
								className="flex items-center justify-between text-sm"
							>
								<div>
									<span>{ban.reason}</span>
									<span className="ml-2">
										<Badge variant="outline">{ban.type}</Badge>
									</span>
								</div>
								<span className="text-xs text-muted-foreground">
									{formatDate(new Date(ban.timestamp * 1000), "date")}
								</span>
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
