import Image from "next/image";
import { Clock } from "@/components/clock";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LiveOnlineCount } from "@/components/live-online-count";
import { Reveal } from "@/components/motion-reveal";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { ICON_LIGHTHOUSE } from "@/lib/site-icons";

/**
 * Shared frosted-glass top bar for the public pages (index, login, register).
 * Shows the hotel logo on the left and the live "online" counter (which carries
 * the hotel name), language / clock / theme controls on the right. One
 * component so every public page keeps the exact same chrome instead of
 * duplicating it.
 */
export function AuthTopBar({
	hotelName,
	logo,
	online,
}: {
	hotelName: string;
	logo?: string | null;
	/** Live online count; omit (or pass null) to hide the indicator. */
	online?: number | null;
}) {
	return (
		<Reveal>
			<div
				className="panel relative flex items-center justify-between gap-3 rounded-full px-3 py-2.5 sm:px-5"
				style={{
					background:
						"linear-gradient(90deg, var(--panel-surface), color-mix(in srgb, var(--color-primary) 7%, var(--panel-surface)))",
				}}
			>
				<div className="flex min-w-0 items-center gap-2 sm:gap-3">
					{logo ? (
						<Image
							src={logo}
							alt={hotelName}
							width={100}
							height={28}
							className="shrink-0 object-contain"
							unoptimized
							style={{ maxHeight: 26, width: "auto", height: "auto" }}
						/>
					) : (
						<div
							className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
							style={{
								background:
									"linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-accent) 60%, var(--color-primary)))",
								boxShadow:
									"0 4px 16px -4px color-mix(in srgb, var(--color-primary) 60%, transparent)",
							}}
						>
							<Image
								src={ICON_LIGHTHOUSE}
								alt=""
								width={18}
								height={18}
								className="shrink-0"
								unoptimized
								style={{ filter: "brightness(0) invert(1)" }}
							/>
						</div>
					)}
				</div>
				<div
					className="flex items-center gap-1 sm:gap-1.5 rounded-full px-1.5 py-1 sm:px-2"
					style={{
						background:
							"color-mix(in srgb, var(--color-text-muted) 5%, transparent)",
					}}
				>
					{typeof online === "number" && (
						<span
							className="flex items-center gap-1.5 px-1"
							style={{ color: "var(--color-text-readable)" }}
						>
							<span className="relative flex h-2 w-2 shrink-0">
								<span
									className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
									style={{ background: "var(--color-primary)" }}
								/>
								<span
									className="relative inline-flex h-2 w-2 rounded-full"
									style={{ background: "var(--color-primary)" }}
								/>
							</span>
							<span
								className="text-xs font-black tabular-nums"
								style={{
									color: "var(--color-primary-readable, var(--color-primary))",
								}}
							>
								<LiveOnlineCount initial={online} hotelName={hotelName} />
							</span>
						</span>
					)}
					<LanguageSwitcher />
					<div
						className="hidden sm:block w-px h-5"
						style={{
							background:
								"color-mix(in srgb, var(--color-text-muted) 12%, transparent)",
						}}
					/>
					<Clock />
					<div
						className="w-px h-5"
						style={{
							background:
								"color-mix(in srgb, var(--color-text-muted) 12%, transparent)",
						}}
					/>
					<ThemeSwitcher />
				</div>
			</div>
		</Reveal>
	);
}
