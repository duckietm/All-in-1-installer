"use client";
import { cn } from "@/lib/utils";
/* ─── Helpers ────────────────────────────────────────────── */

export function categorizePerms(keys: string[]) {
	const commands: string[] = [];
	const account: string[] = [];
	const other: string[] = [];
	for (const key of keys.sort()) {
		if (key.startsWith("cmd_") || key === "kiss_cmd") commands.push(key);
		else if (key.startsWith("acc_")) account.push(key);
		else other.push(key);
	}
	return { commands, account, other };
}

/* ─── Tri-state Toggle ───────────────────────────────────── */

export function PermToggle({
	value,
	maxValue,
	onChange,
}: {
	value: string;
	maxValue: number;
	onChange: (v: string) => void;
}) {
	const values = Array.from({ length: Math.max(1, maxValue) + 1 }, (_, i) =>
		String(i),
	);
	return (
		<div className="flex gap-0.5 shrink-0">
			{values.map((v) => (
				<button
					key={v}
					type="button"
					aria-pressed={v === value}
					aria-label={`Permission value ${v}`}
					onClick={() => onChange(v)}
					className={cn(
						"w-7 h-6 text-[11px] font-mono rounded transition-all font-medium",
						v === value
							? v === "0"
								? "bg-[var(--admin-text-muted)] text-[var(--color-surface-text-readable)] shadow-sm"
								: v === "1"
									? "bg-[var(--admin-success)] text-[var(--admin-success-foreground)] shadow-sm"
									: "bg-[var(--admin-warning)] text-[var(--admin-warning-foreground)] shadow-sm"
							: "bg-muted/60 text-muted-foreground/40 hover:bg-muted hover:text-muted-foreground",
					)}
				>
					{v}
				</button>
			))}
		</div>
	);
}
