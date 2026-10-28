"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { toggleUserWatch } from "@/actions/watch";
import { Button } from "@/components/ui/button";

interface UserWatchToggleProps {
	targetUserId: number;
	username: string;
	initialWatching: boolean;
}

export function UserWatchToggle({
	targetUserId,
	username,
	initialWatching,
}: UserWatchToggleProps) {
	const [watching, setWatching] = useState(initialWatching);
	const [busy, setBusy] = useState(false);

	async function handleToggle() {
		setBusy(true);
		try {
			const result = await toggleUserWatch({ targetUserId });
			if (result.ok) {
				const data = result.data as { watching: boolean };
				setWatching(data.watching);
				toast.success(
					data.watching
						? `Now watching ${username}`
						: `Stopped watching ${username}`,
				);
			} else {
				toast.error(result.error);
			}
		} finally {
			setBusy(false);
		}
	}

	return (
		<Button
			variant={watching ? "default" : "outline"}
			size="sm"
			disabled={busy}
			onClick={handleToggle}
			title={watching ? "Stop watching this user" : "Watch this user"}
		>
			{watching ? (
				<>
					<Eye className="mr-1.5 h-3.5 w-3.5" /> Watching
				</>
			) : (
				<>
					<EyeOff className="mr-1.5 h-3.5 w-3.5" /> Watch
				</>
			)}
		</Button>
	);
}
