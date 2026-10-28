import type { ReactNode } from "react";

/**
 * Public-site design system, faithful to AtomCMS's "atom" theme. The signature
 * element is the content-card: a surface card with a primary-tinted header
 * (icon circle + title + subtitle) and a padded body. These mirror the atom
 * Blade components (content-card, stat blocks, empty states) so every public
 * page shares one consistent, themeable look.
 */

export function ContentCard({
	icon,
	title,
	subtitle,
	action,
	children,
	className,
	padded = true,
}: {
	icon?: string;
	title?: ReactNode;
	subtitle?: ReactNode;
	action?: ReactNode;
	children?: ReactNode;
	className?: string;
	padded?: boolean;
}) {
	const hasHead =
		title != null || icon != null || subtitle != null || action != null;
	return (
		<div className={`content-card${className ? ` ${className}` : ""}`}>
			{hasHead ? (
				<div className="content-card-head">
					{icon ? (
						<span className="content-card-icon" aria-hidden>
							{icon}
						</span>
					) : null}
					<div className="content-card-head-text">
						{title != null ? (
							<p className="content-card-title">{title}</p>
						) : null}
						{subtitle != null ? (
							<p className="content-card-subtitle">{subtitle}</p>
						) : null}
					</div>
					{action ? <div className="content-card-action">{action}</div> : null}
				</div>
			) : null}
			<div className={padded ? "content-card-body" : undefined}>{children}</div>
		</div>
	);
}

/** A value + label tile (profile stats, rare-value summaries, …). */
export function StatBlock({
	value,
	label,
	icon,
}: {
	value: ReactNode;
	label: string;
	icon?: string;
}) {
	return (
		<div className="stat-block">
			<div className="stat-block-value">
				{icon ? <span aria-hidden>{icon} </span> : null}
				{value}
			</div>
			<div className="stat-block-label">{label}</div>
		</div>
	);
}

/** Friendly empty state with an icon and a muted line. */
export function EmptyState({
	icon = "📭",
	children,
}: {
	icon?: string;
	children: ReactNode;
}) {
	return (
		<div className="empty-state">
			<div className="empty-state-icon" aria-hidden>
				{icon}
			</div>
			<p className="muted" style={{ margin: 0 }}>
				{children}
			</p>
		</div>
	);
}

/** Online / offline pill with a status dot. */
export function OnlineBadge({ online }: { online: boolean }) {
	return (
		<span className={`online-badge${online ? " online" : ""}`}>
			<span className="online-dot" aria-hidden />
			{online ? "Online" : "Offline"}
		</span>
	);
}

/** Leaderboard rank chip — medals for the top three, number otherwise. */
export function RankBadge({ position }: { position: number }) {
	const medal =
		position === 1
			? "🥇"
			: position === 2
				? "🥈"
				: position === 3
					? "🥉"
					: null;
	return (
		<span className={`rank-badge rank-${position <= 3 ? position : "n"}`}>
			{medal ?? `#${position}`}
		</span>
	);
}
