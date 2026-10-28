interface CommandTriggerProps {
	label: string;
}

export function CommandTrigger({ label }: CommandTriggerProps) {
	return (
		<button
			type="button"
			disabled
			className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text-muted)]"
		>
			{label}
		</button>
	);
}
