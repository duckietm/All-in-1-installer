import Image from "next/image";
import type { ReactNode } from "react";
import { SurfaceCard } from "@/components/surface-card";

interface AuthPromoCardProps {
	/** Fully formatted "N users online" label. */
	onlineLabel: string;
	title: ReactNode;
	/** Optional supporting line under the title. */
	subtitle?: ReactNode;
}

/**
 * The single promo panel both `/login` and `/register` show above the form:
 * Frank, the online badge and a short welcome. Keeping it in one place means
 * the two auth pages can never drift apart visually again.
 */
export function AuthPromoCard({
	onlineLabel,
	title,
	subtitle,
}: AuthPromoCardProps) {
	return (
		<SurfaceCard
			className="card-glow relative overflow-hidden p-6 text-center"
			style={{
				borderColor:
					"color-mix(in srgb, var(--color-primary) 20%, transparent)",
			}}
		>
			<div
				className="absolute inset-0"
				style={{
					background:
						"linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 10%, transparent), color-mix(in srgb, var(--color-accent) 10%, transparent))",
				}}
			/>
			<div aria-hidden="true" className="absolute inset-0 overflow-hidden">
				<div className="brand-halo left-1/2 top-0 h-64 w-[460px] max-w-full -translate-x-1/2 -translate-y-1/2" />
				<div
					className="aurora-blob -left-16 top-10 h-56 w-56"
					style={{
						background:
							"color-mix(in srgb, var(--color-primary) 45%, transparent)",
					}}
				/>
				<div
					className="aurora-blob -right-16 bottom-0 h-56 w-56"
					style={{
						background:
							"color-mix(in srgb, var(--color-accent) 40%, transparent)",
						animationDelay: "-8s",
					}}
				/>
			</div>
			<div className="relative">
				<div className="brand-halo left-1/2 top-8 h-52 w-52 -translate-x-1/2" />
				<Image
					src="/assets/images/FrankwithBag.gif"
					alt="Frank"
					width={130}
					height={170}
					className="relative object-contain mx-auto drop-shadow-xl animate-float"
					unoptimized
				/>
				<div
					className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider mt-4 mb-3 border"
					style={{
						borderColor:
							"color-mix(in srgb, var(--color-primary) 30%, transparent)",
						background:
							"color-mix(in srgb, var(--color-surface) 72%, transparent)",
						color: "var(--color-primary-readable, var(--color-primary))",
						boxShadow:
							"0 8px 20px -12px color-mix(in srgb, var(--color-primary) 70%, transparent)",
					}}
				>
					<span className="relative flex h-2 w-2">
						<span
							className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
							style={{ background: "var(--color-primary)" }}
						/>
						<span
							className="relative inline-flex rounded-full h-2 w-2"
							style={{ background: "var(--color-primary)" }}
						/>
					</span>
					{onlineLabel}
				</div>
				<h1
					className="text-xl font-black"
					style={{
						color: "var(--color-text-readable)",
						fontFamily: "var(--font-nunito)",
					}}
				>
					{title}
				</h1>
				{subtitle && (
					<p
						className="text-xs mt-1.5 mx-auto max-w-[240px] leading-relaxed"
						style={{ color: "var(--color-text-muted)" }}
					>
						{subtitle}
					</p>
				)}
			</div>
		</SurfaceCard>
	);
}
