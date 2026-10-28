"use client";

import {
	Check,
	Copy,
	KeyRound,
	MessageCircle,
	Unplug,
	Volume2,
	VolumeX,
} from "lucide-react";
import { useState } from "react";
import { setTradeLock } from "@/actions/bulk-users";
import {
	alertUser,
	disconnectUser,
	muteUser,
	resetPassword,
	sendCredits,
	unmuteUser,
} from "@/actions/users";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { CurrencyIcon } from "@/components/shared/currency-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerAction } from "@/hooks/use-server-action";
import { formatNumber } from "@/lib/format-date";

interface UserQuickActionsProps {
	userId: number;
	username: string;
	isOnline: boolean;
}

export function UserQuickActions({
	userId,
	username,
	isOnline,
}: UserQuickActionsProps) {
	const { run, isPending } = useServerAction();
	const { confirm, dialog: confirmDialog } = useConfirmDialog();

	// Reset password state
	const [newPassword, setNewPassword] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	// Alert state
	const [alertMessage, setAlertMessage] = useState("");

	// Mute state
	const [muteDuration, setMuteDuration] = useState("10");

	// Credits state
	const [creditAmount, setCreditAmount] = useState("1000");

	async function handleResetPassword() {
		const ok = await confirm({
			title: "Reset password",
			description: `Reset password for ${username}? A new random password will be generated.`,
			confirmLabel: "Reset",
			variant: "danger",
		});
		if (!ok) return;
		run(() => resetPassword({ userId }), {
			successMessage: "Password reset successfully.",
			onSuccess: (data) => {
				setNewPassword(data.newPassword as string);
			},
		});
	}

	function handleDisconnect() {
		run(() => disconnectUser({ userId }), {
			successMessage: `${username} disconnected.`,
		});
	}

	function handleAlert() {
		if (!alertMessage.trim()) return;
		run(() => alertUser({ userId, message: alertMessage.trim() }), {
			successMessage: "Alert sent.",
			onSuccess: () => setAlertMessage(""),
		});
	}

	function handleMute() {
		const duration = Number(muteDuration);
		if (Number.isNaN(duration) || duration < 0) return;
		run(() => muteUser({ userId, duration }), {
			successMessage: `${username} muted.`,
		});
	}

	function handleUnmute() {
		run(() => unmuteUser({ userId }), {
			successMessage: `${username} unmuted.`,
		});
	}

	function handleSendCredits() {
		const amount = parseInt(creditAmount, 10);
		if (!amount || amount <= 0) return;
		run(() => sendCredits({ userId, amount }), {
			successMessage: `${formatNumber(amount)} credits sent to ${username}.`,
		});
	}

	function copyPassword() {
		if (newPassword) {
			navigator.clipboard.writeText(newPassword);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	}

	return (
		<>
			{confirmDialog}
			<Card>
				<CardHeader>
					<CardTitle>Quick Actions</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{/* Row 1: Password + Disconnect */}
					<div className="grid grid-cols-2 gap-3">
						<Button
							variant="outline"
							onClick={handleResetPassword}
							disabled={isPending}
							className="justify-start"
						>
							<KeyRound className="mr-2 h-4 w-4" />
							Reset Password
						</Button>
						<Button
							variant="outline"
							onClick={handleDisconnect}
							disabled={isPending || !isOnline}
							className="justify-start"
						>
							<Unplug className="mr-2 h-4 w-4" />
							Disconnect
							{isOnline && (
								<Badge
									variant="default"
									className="ml-auto text-[10px] bg-[var(--admin-success-subtle)]"
								>
									Online
								</Badge>
							)}
						</Button>
					</div>

					{/* Send Alert */}
					<div className="space-y-2">
						<Label className="text-xs text-muted-foreground">
							Send In-Game Alert
						</Label>
						<div className="flex gap-2">
							<Input
								placeholder="Message to send..."
								value={alertMessage}
								onChange={(e) => setAlertMessage(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && handleAlert()}
								className="flex-1"
							/>
							<Button
								onClick={handleAlert}
								disabled={isPending || !alertMessage.trim()}
								size="icon"
							>
								<MessageCircle className="h-4 w-4" />
							</Button>
						</div>
					</div>

					{/* Mute */}
					<div className="space-y-2">
						<Label className="text-xs text-muted-foreground">
							Mute / Unmute
						</Label>
						<div className="flex gap-2">
							<Input
								type="number"
								placeholder="Minutes (0 = permanent)"
								value={muteDuration}
								onChange={(e) => setMuteDuration(e.target.value)}
								className="w-32"
							/>
							<Button
								variant="outline"
								onClick={handleMute}
								disabled={isPending}
								size="sm"
							>
								<VolumeX className="mr-1.5 h-3.5 w-3.5" /> Mute
							</Button>
							<Button
								variant="outline"
								onClick={handleUnmute}
								disabled={isPending}
								size="sm"
							>
								<Volume2 className="mr-1.5 h-3.5 w-3.5" /> Unmute
							</Button>
						</div>
					</div>

					{/* Send Credits */}
					<div className="space-y-2">
						<Label className="text-xs text-muted-foreground">
							Send Credits (RCON)
						</Label>
						<div className="flex gap-2">
							<Input
								type="number"
								value={creditAmount}
								onChange={(e) => setCreditAmount(e.target.value)}
								className="w-32"
								min={1}
							/>
							<Button
								variant="outline"
								onClick={handleSendCredits}
								disabled={isPending}
								size="sm"
							>
								<CurrencyIcon kind="credits" size={14} className="mr-1.5" />{" "}
								Send Credits
							</Button>
						</div>
					</div>

					{/* Trade lock (DB only — no RCON helper) */}
					<div className="space-y-2">
						<Label className="text-xs text-muted-foreground">
							Trade lock (CMS DB)
						</Label>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={isPending}
								onClick={() => {
									const until = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
									run(() => setTradeLock({ userId, untilUnix: until }), {
										successMessage: `${username} trade-locked for 7 days.`,
									});
								}}
							>
								Lock 7d
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={isPending}
								onClick={() => {
									run(() => setTradeLock({ userId, untilUnix: 0 }), {
										successMessage: `${username} trade lock cleared.`,
									});
								}}
							>
								Clear lock
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Password Reset Dialog */}
			<Dialog open={!!newPassword} onOpenChange={() => setNewPassword(null)}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>Password Reset</DialogTitle>
						<DialogDescription>
							New password generated for <strong>{username}</strong>. Copy it
							now — it won&apos;t be shown again.
						</DialogDescription>
					</DialogHeader>
					<div className="flex items-center gap-2 rounded-lg border bg-muted p-3">
						<code className="flex-1 text-lg font-mono font-bold tracking-wider select-all">
							{newPassword}
						</code>
						<Button variant="ghost" size="icon" onClick={copyPassword}>
							{copied ? (
								<Check className="h-4 w-4 text-[var(--admin-success)]" />
							) : (
								<Copy className="h-4 w-4" />
							)}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
