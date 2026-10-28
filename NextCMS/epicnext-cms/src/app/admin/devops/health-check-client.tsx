"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function HealthCheckClient() {
	const [status, setStatus] = useState<"checking" | "online" | "offline">(
		"checking",
	);
	const [checking, setChecking] = useState(false);

	// Must be stable: the effect below depends on it. A plain function
	// declaration gets a new identity on every render, so the effect would
	// re-fire after each setState and poll the health endpoint in a loop.
	const checkEmulator = useCallback(async () => {
		setChecking(true);
		setStatus("checking");
		try {
			const res = await fetch("/cms_api/admin/devops/health");
			if (res.ok) {
				const data = await res.json();
				setStatus(data.emulator ? "online" : "offline");
			} else {
				setStatus("offline");
			}
		} catch {
			setStatus("offline");
		} finally {
			setChecking(false);
		}
	}, []);

	useEffect(() => {
		checkEmulator();
	}, [checkEmulator]);

	return (
		<div className="flex items-center gap-2">
			<Badge
				variant={
					status === "online"
						? "default"
						: status === "offline"
							? "destructive"
							: "secondary"
				}
			>
				{status === "checking"
					? "Checking..."
					: status === "online"
						? "Online"
						: "Offline"}
			</Badge>
			<Button
				variant="ghost"
				size="icon"
				className="h-6 w-6"
				onClick={checkEmulator}
				disabled={checking}
			>
				<RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
			</Button>
		</div>
	);
}
