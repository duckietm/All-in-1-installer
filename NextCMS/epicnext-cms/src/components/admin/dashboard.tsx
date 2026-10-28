import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type { OnlineUser } from "@/components/admin/online-users-widget";
export { OnlineUsersWidget } from "@/components/admin/online-users-widget";

type State = "ok" | "warn" | "danger" | "neutral";

const STATE_RING: Record<State, string> = {
	ok: "ring-1 ring-[var(--admin-success-subtle)]/50 border-[var(--admin-success-subtle)]/40",
	warn: "ring-1 ring-[var(--admin-accent)]/40 border-[var(--admin-accent)]/35",
	danger:
		"ring-1 ring-[var(--admin-error-subtle)]/50 border-[var(--admin-error-subtle)]/45",
	neutral: "border-[var(--admin-border)]",
};

const STATE_ICON_BG: Record<State, string> = {
	ok: "from-[var(--admin-success-subtle)]/25 to-[var(--admin-success-subtle)]/5 text-[var(--admin-success)]",
	warn: "from-[var(--admin-accent)]/20 to-[var(--admin-accent)]/5 text-[var(--admin-accent)]",
	danger:
		"from-[var(--admin-error-subtle)]/25 to-[var(--admin-error-subtle)]/5 text-[var(--admin-error)]",
	neutral:
		"from-[var(--admin-accent)]/15 to-[var(--admin-accent)]/5 text-[var(--admin-accent)]",
};

/** A single live-status tile (online users, emulator, DB, …). Server-safe. */
export function StatusCard({
	label,
	value,
	hint,
	state = "neutral",
	icon,
}: {
	label: string;
	value: ReactNode;
	hint?: string;
	state?: State;
	icon?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"bg-[var(--admin-surface)] border rounded-2xl p-5 shadow-card hover:shadow-card-hover transition-shadow duration-200",
				STATE_RING[state],
			)}
		>
			<div className="flex items-center justify-between gap-3 mb-3">
				<span className="text-[0.65rem] font-bold uppercase tracking-widest text-[var(--admin-text-muted)]">
					{label}
				</span>
				{icon ? (
					<span
						className={cn(
							"w-8 h-8 rounded-xl bg-gradient-to-br grid place-items-center flex-none",
							STATE_ICON_BG[state],
						)}
					>
						{icon}
					</span>
				) : null}
			</div>
			<div className="text-2xl font-extrabold text-[var(--admin-text)] leading-tight">
				{value}
			</div>
			{hint ? (
				<div className="text-[0.7rem] text-[var(--admin-text-muted)] mt-1.5 font-medium">
					{hint}
				</div>
			) : null}
		</div>
	);
}

/** A row in the system-diagnostics list with an ok/warn/error pill. */
export function DiagnosticRow({
	label,
	detail,
	state,
}: {
	label: string;
	detail: string;
	state: Exclude<State, "neutral">;
}) {
	const text = state === "ok" ? "OK" : state === "warn" ? "WARN" : "ERROR";
	const dotColor =
		state === "ok"
			? "bg-[var(--admin-success-subtle)] shadow-[0_0_0_3px_rgba(22,163,74,0.22)]"
			: state === "warn"
				? "bg-[var(--admin-accent)] shadow-[0_0_0_3px_rgba(238,180,37,0.22)]"
				: "bg-[var(--admin-error-subtle)] shadow-[0_0_0_3px_rgba(239,68,68,0.22)]";
	const badgeColor =
		state === "ok"
			? "bg-[var(--admin-success-subtle)]"
			: state === "danger"
				? "bg-[var(--admin-error-subtle)]"
				: "bg-[var(--admin-accent)]/18";

	return (
		<div className="flex items-center gap-2.5 py-2 px-0.5 border-t border-[var(--admin-border)] first:border-t-0">
			<span
				className={`flex-none w-[9px] h-[9px] rounded-full ${dotColor}`}
				aria-hidden
			/>
			<span className="font-bold text-sm">{label}</span>
			<span className="flex-1 text-[0.82rem] text-[var(--admin-text-muted)]">
				{detail}
			</span>
			<span
				className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${badgeColor} text-[var(--admin-text)]`}
			>
				{text}
			</span>
		</div>
	);
}

/** Small labelled key/value used in the server-info card. */
export function InfoItem({
	label,
	value,
}: {
	label: string;
	value: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-0.5 text-sm">
			<span className="text-[var(--admin-text-muted)]">{label}</span>
			<strong>{value}</strong>
		</div>
	);
}
