import Image from "next/image";
import { ICON_LIGHTHOUSE } from "@/lib/site-icons";

export default function ClientLoading() {
	return (
		<div
			className="relative flex items-center justify-center min-h-screen overflow-hidden"
			style={{
				background:
					"radial-gradient(ellipse at center, color-mix(in srgb, var(--color-surface) 80%, transparent) 0%, var(--color-background) 75%)",
			}}
		>
			<div
				className="absolute inset-0 animate-pulse-glow"
				style={{
					background:
						"radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--color-primary) 12%, transparent) 0%, transparent 55%)",
				}}
			/>
			<div className="relative flex flex-col items-center gap-6">
				<div
					className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-2xl"
					style={{
						background:
							"linear-gradient(135deg, var(--color-primary) 0%, color-mix(in srgb, var(--color-primary) 70%, black) 100%)",
						boxShadow:
							"0 12px 40px color-mix(in srgb, var(--color-primary) 35%, transparent)",
					}}
				>
					<Image
						src={ICON_LIGHTHOUSE}
						alt=""
						width={44}
						height={44}
						unoptimized
					/>
				</div>
				<div
					className="animate-spin w-9 h-9 border-[3px] rounded-full"
					style={{
						borderColor:
							"color-mix(in srgb, var(--color-text-muted) 18%, transparent)",
						borderTopColor: "var(--color-primary)",
					}}
				/>
			</div>
		</div>
	);
}
