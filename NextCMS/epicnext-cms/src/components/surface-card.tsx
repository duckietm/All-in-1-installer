import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import Link from "@/components/link";

const CARD_BORDER =
	"color-mix(in srgb, var(--color-text-muted) 10%, transparent)";
const CARD_DIVIDER =
	"color-mix(in srgb, var(--color-text-muted) 8%, transparent)";
const CARD_HEADER_BG =
	"linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 8%, var(--color-surface)), color-mix(in srgb, var(--color-primary) 4%, var(--color-surface)))";

export interface SurfaceCardProps {
	children: ReactNode;
	/** Optional header title. */
	title?: string;
	/** Optional header icon (image URL). */
	icon?: string;
	/** Optional header action link. */
	actionHref?: string;
	actionLabel?: string;
	/** Class for the body wrapper (only used when a header is present). */
	bodyClassName?: string;
	className?: string;
	style?: CSSProperties;
}

/**
 * The single public-site card component. Mirrors the CSS `.content-card` visual
 * language (--radius-lg corners, --shadow-card, hairline border). Pass `title`
 * / `icon` / `actionHref` to render a section header, exactly like the old
 * a card header. Without a header, children render directly so callers control
 * padding via `className`.
 */
export function SurfaceCard({
	children,
	title,
	icon,
	actionHref,
	actionLabel,
	bodyClassName,
	className = "",
	style,
}: SurfaceCardProps) {
	const hasHeader = Boolean(title || icon || (actionHref && actionLabel));

	const CARD_SHADOW =
		"0 1px 2px rgba(0,0,0,0.05), 0 8px 24px -10px color-mix(in srgb, var(--color-text-muted) 22%, transparent), 0 0 0 0.5px color-mix(in srgb, var(--color-text-muted) 6%, transparent)";

	return (
		<div
			className={`surface-card card-hairline overflow-hidden rounded-xl border bg-[var(--color-surface)] ${className}`}
			style={{
				borderColor: CARD_BORDER,
				boxShadow: CARD_SHADOW,
				...style,
			}}
		>
			{hasHeader && (
				<div
					className="flex items-center justify-between gap-3 px-5 py-3.5 border-b"
					style={{ borderColor: CARD_DIVIDER, background: CARD_HEADER_BG }}
				>
					<div className="flex items-center gap-2.5">
						{icon && (
							<div
								className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
								style={{
									background:
										"linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 18%, var(--color-surface)), color-mix(in srgb, var(--color-primary) 10%, var(--color-surface)))",
									boxShadow:
										"inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 14%, transparent)",
								}}
							>
								<Image
									src={icon}
									alt=""
									width={16}
									height={16}
									unoptimized
									className="opacity-80"
								/>
							</div>
						)}
						{title && (
							<h2
								className="text-sm font-extrabold tracking-wide"
								style={{
									fontFamily: "var(--font-nunito)",
									color: "var(--color-text-readable)",
								}}
							>
								{title}
							</h2>
						)}
					</div>
					{actionHref && actionLabel && (
						<Link
							href={actionHref}
							className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold transition-colors hover:bg-[color-mix(in_srgb,var(--color-primary)_8%,transparent)] hover:text-[var(--color-primary)]"
							style={{ color: "var(--color-text-muted)" }}
						>
							{actionLabel}
						</Link>
					)}
				</div>
			)}
			{hasHeader ? (
				<div className={bodyClassName ?? "p-5"}>{children}</div>
			) : (
				children
			)}
		</div>
	);
}
