import Image from "next/image";
import Link from "@/components/link";
import { LiveOnlineCount } from "@/components/live-online-count";
import { resolveHotelName } from "@/lib/hotel-name";
import { cachedOnlineCount } from "@/lib/services/public-counters";
import { siteSettings } from "@/lib/services/site-settings";

export async function SiteHeader() {
	const [hotelName, header, logo] = await Promise.all([
		resolveHotelName(),
		siteSettings.get("cms_header", "/assets/images/background.png"),
		siteSettings.get("cms_logo", ""),
	]);

	let online: number;
	try {
		online = await cachedOnlineCount();
	} catch {
		online = 0;
	}

	const bannerUrl =
		header && header !== "/assets/images/background.png"
			? header
			: "/assets/images/background.png";

	return (
		<div
			className="site-header relative w-full overflow-hidden"
			style={{ minHeight: "clamp(10rem, 25vw, 18rem)" }}
		>
			{/* Background image */}
			<div
				className="absolute inset-0"
				style={{ background: `url(${bannerUrl}) center/cover no-repeat` }}
			/>

			{/* Gradient overlays */}
			<div
				className="absolute inset-0"
				style={{
					background:
						"linear-gradient(135deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.25) 35%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.4) 75%, rgba(0,0,0,0.7) 100%)",
				}}
			/>

			{/* Subtle dot pattern */}
			<div
				className="absolute inset-0 opacity-[0.04]"
				style={{
					backgroundImage:
						"radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)",
					backgroundSize: "20px 20px",
				}}
			/>

			{/* Decorative glows */}
			<div
				className="absolute -top-24 -right-24 w-64 h-64 sm:w-96 sm:h-96 rounded-full opacity-[0.12] blur-[120px]"
				style={{ background: "var(--color-primary)" }}
			/>
			<div
				className="absolute -bottom-24 -left-24 w-48 h-48 sm:w-72 sm:h-72 rounded-full opacity-[0.08] blur-[100px]"
				style={{ background: "var(--color-primary)" }}
			/>

			{/* Content */}
			<div className="relative flex flex-col items-center justify-center px-3 py-6 sm:px-4 sm:py-8 md:py-12 min-h-[clamp(10rem,25vw,18rem)]">
				<Link
					href="/"
					className="transition-transform duration-300 hover:scale-105 mb-5 sm:mb-8"
				>
					{logo ? (
						<Image
							className="drop-shadow-2xl block"
							src={logo}
							alt={hotelName}
							width={200}
							height={120}
							style={{
								maxHeight: "clamp(60px, 15vw, 120px)",
								width: "auto",
								height: "auto",
							}}
							unoptimized
						/>
					) : (
						<div className="text-center">
							<h1
								className="font-black tracking-tight leading-none text-primary-foreground"
								style={{
									fontFamily: "var(--font-nunito)",
									fontSize: "clamp(2rem, 7vw, 5.5rem)",
									textShadow:
										"0 2px 20px rgba(0,0,0,0.4), 0 8px 40px rgba(0,0,0,0.2)",
									letterSpacing: "0.04em",
								}}
							>
								{hotelName}
							</h1>
							<p
								className="text-xs sm:text-sm md:text-base font-bold tracking-[0.15em] uppercase mt-1"
								style={{
									color: "color-mix(in srgb, var(--color-primary) 70%, white)",
									textShadow: "0 2px 12px rgba(0,0,0,0.5)",
									letterSpacing: "0.2em",
								}}
							>
								Hotel
							</p>
						</div>
					)}
				</Link>

				{/* Online badge */}
				<div
					className="flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-2 sm:py-3 rounded-full"
					style={{
						background: "rgba(255,255,255,0.08)",
						backdropFilter: "blur(16px)",
						WebkitBackdropFilter: "blur(16px)",
						border: "1px solid rgba(255,255,255,0.10)",
						boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
					}}
				>
					<span className="relative flex h-2 w-2 sm:h-2.5 sm:w-2.5">
						<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
						<span className="relative inline-flex rounded-full h-2 w-2 sm:h-2.5 sm:w-2.5 bg-primary" />
					</span>
					<span
						className="text-xs sm:text-sm font-bold tracking-wide"
						style={{ color: "rgba(255,255,255,0.9)" }}
					>
						<LiveOnlineCount initial={online} hotelName={hotelName} />
					</span>
				</div>
			</div>
		</div>
	);
}
