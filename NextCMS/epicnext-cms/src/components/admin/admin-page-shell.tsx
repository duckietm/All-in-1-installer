import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface AdminPageShellProps {
	icon?: LucideIcon;
	title: string;
	subtitle?: string;
	actions?: ReactNode;
	tabs?: ReactNode;
	children: ReactNode;
	className?: string;
}

/** Shared admin page chrome: icon title, optional actions/tabs, then body. */
export function AdminPageShell({
	icon: Icon,
	title,
	subtitle,
	actions,
	tabs,
	children,
	className = "",
}: AdminPageShellProps) {
	return (
		<div className={`space-y-5 ${className}`.trim()}>
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex items-center gap-3 min-w-0">
					{Icon ? (
						<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--admin-accent)]/20 to-[var(--admin-accent)]/5 grid place-items-center shrink-0">
							<Icon size={20} className="text-[var(--admin-accent)]" />
						</div>
					) : null}
					<div className="min-w-0">
						<h1 className="m-0 text-2xl font-extrabold tracking-tight text-[var(--admin-text)]">
							{title}
						</h1>
						{subtitle ? (
							<p className="m-0 mt-0.5 text-sm text-[var(--admin-text-muted)]">
								{subtitle}
							</p>
						) : null}
					</div>
				</div>
				{actions ? (
					<div className="flex flex-wrap items-center gap-2">{actions}</div>
				) : null}
			</div>
			{tabs}
			<div className="min-w-0">{children}</div>
		</div>
	);
}
