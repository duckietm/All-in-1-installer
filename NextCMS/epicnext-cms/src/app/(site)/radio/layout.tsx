import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import Link from "@/components/link";

const RADIO_SIDEBAR_LINKS = [
	{ key: "schedule", href: "/radio/schedule", icon: "🗓️" },
	{ key: "shouts", href: "/radio/shouts", icon: "📣" },
	{ key: "requests", href: "/radio/requests", icon: "🎵" },
	{ key: "apply", href: "/radio/apply", icon: "🎤" },
	{ key: "leaderboard", href: "/radio/leaderboard", icon: "🏆" },
] as const;

export default async function RadioLayout({
	children,
}: {
	children: ReactNode;
}) {
	const t = await getTranslations("pages.radio");

	return (
		<div
			className="radio-layout"
			style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start" }}
		>
			<aside
				className="radio-sidebar"
				style={{
					flex: "none",
					width: "200px",
					position: "sticky",
					top: "5rem",
					display: "flex",
					flexDirection: "column",
					gap: "0.25rem",
				}}
			>
				<Link
					href="/radio"
					className="radio-sidebar-head"
					style={{
						display: "flex",
						alignItems: "center",
						gap: "0.5rem",
						padding: "0.55rem 0.75rem",
						fontWeight: 700,
						fontSize: "1rem",
						color: "var(--color-text-readable, var(--color-text))",
						textDecoration: "none",
						borderBottom:
							"1px solid color-mix(in srgb, var(--color-text-muted) 14%, transparent)",
						marginBottom: "0.25rem",
					}}
				>
					<span aria-hidden style={{ fontSize: "1.2rem" }}>
						📻
					</span>
					Radio
				</Link>
				{RADIO_SIDEBAR_LINKS.map((link) => (
					<Link
						key={link.href}
						href={link.href}
						className="radio-sidebar-link"
						style={{
							display: "flex",
							alignItems: "center",
							gap: "0.5rem",
							padding: "0.5rem 0.75rem",
							borderRadius: "8px",
							color: "var(--color-text-readable, var(--color-text))",
							textDecoration: "none",
							fontSize: "0.9rem",
							transition: "background 0.15s",
						}}
					>
						<span aria-hidden style={{ flex: "none", fontSize: "1rem" }}>
							{link.icon}
						</span>
						{link.key === "schedule"
							? t("linkSchedule")
							: link.key === "shouts"
								? t("linkShouts")
								: link.key === "requests"
									? t("linkRequests")
									: link.key === "apply"
										? t("linkApply")
										: t("linkLeaderboard")}
					</Link>
				))}
			</aside>
			<section style={{ flex: 1, minWidth: 0 }}>{children}</section>
		</div>
	);
}
