"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export function CheckboxDot({ checked }: { checked: boolean }) {
	return (
		<span
			className={cn(
				"grid h-3.5 w-3.5 place-items-center rounded border transition-colors",
				checked
					? "border-[var(--admin-accent)] bg-[var(--admin-accent)]"
					: "border-[var(--admin-border)] bg-transparent",
			)}
		>
			{checked ? (
				<Check size={10} className="text-[var(--admin-accent-foreground)]" />
			) : null}
		</span>
	);
}
