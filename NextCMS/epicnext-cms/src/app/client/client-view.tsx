"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { signOutAndRevokeTicket } from "@/actions/sessions";
import Link from "@/components/link";
import { buildClientLoginUrl } from "@/lib/client-url";
import { useEventSource } from "@/lib/use-event-source";

function ToolbarBtn({
	onClick,
	label,
	children,
	href,
}: {
	onClick?: () => void;
	label: string;
	children: ReactNode;
	href?: string;
}) {
	// Custom floating tooltip: appears on hover/focus regardless of where the
	// element is on screen. Kept in one component for a consistent look across
	// the bar (replaces the browser's slow, untitled `title` bubbles).
	const [tip, setTip] = useState(false);
	const cls =
		"group relative w-8 h-8 sm:w-9 sm:h-9 rounded-xl cursor-pointer flex items-center justify-center transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-primary";
	const style = {
		border:
			"1px solid color-mix(in srgb, var(--color-primary, #eeb425) 85%, white)",
		background:
			"linear-gradient(180deg, color-mix(in srgb, var(--color-primary, #eeb425) 92%, white), var(--color-primary, #eeb425) 55%, color-mix(in srgb, var(--color-primary, #eeb425) 60%, black))",
		color:
			"var(--button-text-color-readable, var(--button-text-color, #1a1a2e))",
		boxShadow:
			"0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 4px rgba(0,0,0,0.12)",
	} as const;

	const trigger = href ? (
		<Link
			href={href}
			className={cls}
			style={style}
			aria-label={label}
			onMouseEnter={() => setTip(true)}
			onMouseLeave={() => setTip(false)}
			onFocus={() => setTip(true)}
			onBlur={() => setTip(false)}
		>
			{children}
		</Link>
	) : (
		<button
			onClick={onClick}
			className={cls}
			style={style}
			type="button"
			aria-label={label}
			onMouseEnter={() => setTip(true)}
			onMouseLeave={() => setTip(false)}
			onFocus={() => setTip(true)}
			onBlur={() => setTip(false)}
		>
			{children}
		</button>
	);

	return (
		<span className="relative inline-flex">
			{trigger}
			{tip && (
				<span
					role="tooltip"
					className="absolute left-1/2 -translate-x-1/2 -top-8 whitespace-nowrap rounded-md bg-foreground backdrop-blur px-2 py-1 text-[10px] font-bold text-background shadow-lg pointer-events-none"
				>
					{label}
				</span>
			)}
		</span>
	);
}

export function ClientView({
	ticket,
	clientUrl,
	hotelName,
	initialOnline,
}: {
	ticket: string;
	clientUrl: string;
	hotelName: string;
	initialOnline: number;
}) {
	const tToolbar = useTranslations("toolbar");
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [onlineCount, setOnlineCount] = useState(initialOnline);
	const [emulatorOk, setEmulatorOk] = useState<boolean | null>(null);
	const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
	const [showOnlineUsers, setShowOnlineUsers] = useState(false);
	const [barHidden, setBarHidden] = useState(false);

	// Real-time online count + emulator status via SSE multicast (replaces the
	// legacy 15s polling).
	const { data: onlineStream } = useEventSource<{
		count: number;
		emulator: boolean;
	}>("/cms_api/online/count/stream", { enabled: true });
	useEffect(() => {
		if (!onlineStream) return;
		if (typeof onlineStream.count === "number")
			setOnlineCount(onlineStream.count);
		if (typeof onlineStream.emulator === "boolean")
			setEmulatorOk(onlineStream.emulator);
	}, [onlineStream]);

	// "Who's online" list, fetched sparingly (server-side cached 10s). Only a
	// fresh fetch is issued when hovered and the last fetch is stale — hovering
	// repeatedly must not spam the endpoint.
	const onlineUsersRef = useRef<number>(0);
	const refreshOnlineUsers = useCallback(() => {
		const now = Date.now();
		if (now - onlineUsersRef.current < 30_000) return;
		onlineUsersRef.current = now;
		fetch("/cms_api/online", { cache: "no-store" })
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				const usernames = Array.isArray(data?.users)
					? data.users
							.map((u: { username?: string }) => u.username)
							.filter((n: unknown): n is string => typeof n === "string")
					: [];
				setOnlineUsers(usernames);
			})
			.catch(() => setOnlineUsers([]));
	}, []);

	const toggleFullscreen = useCallback(() => {
		if (!document.fullscreenElement) {
			document.documentElement.requestFullscreen().catch(() => {});
			setIsFullscreen(true);
		} else {
			document.exitFullscreen().catch(() => {});
			setIsFullscreen(false);
		}
	}, []);

	useEffect(() => {
		function onChange() {
			setIsFullscreen(!!document.fullscreenElement);
		}
		document.addEventListener("fullscreenchange", onChange);
		return () => document.removeEventListener("fullscreenchange", onChange);
	}, []);

	const clientSrc = buildClientLoginUrl(clientUrl, ticket);

	const toolbarRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef({ startX: 0, startY: 0, startTop: 0, startLeft: 0 });
	const posRef = useRef({ top: 8, left: 8 });
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
	const [dragging, setDragging] = useState(false);

	useLayoutEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const ux = params.get("toolbarX"),
			uy = params.get("toolbarY");
		if (ux && uy) {
			setPos({ top: Number(uy), left: Number(ux) });
			return;
		}

		try {
			const sx = localStorage.getItem("client_toolbar_x");
			const sy = localStorage.getItem("client_toolbar_y");
			if (sx && sy) {
				setPos({ top: Number(sy), left: Number(sx) });
				return;
			}
		} catch {}

		const w = toolbarRef.current?.offsetWidth ?? 220;
		setPos({ top: 8, left: Math.round((window.innerWidth - w) / 2) });
	}, []);

	useEffect(() => {
		if (pos) posRef.current = pos;
	}, [pos]);

	const [snapTween, setSnapTween] = useState(false);
	const SNAP = 40;

	function snapPos(top: number, left: number) {
		const el = toolbarRef.current;
		if (!el) return { top, left };
		const w = el.offsetWidth,
			h = el.offsetHeight;
		const vw = window.innerWidth,
			vh = window.innerHeight;
		if (top < SNAP) top = 0;
		else if (top + h > vh - SNAP) top = vh - h;
		if (left < SNAP) left = 0;
		else if (left + w > vw - SNAP) left = vw - w;
		return { top, left };
	}

	const startDrag = useCallback(
		(clientX: number, clientY: number) => {
			if (!pos) return;
			setSnapTween(false);
			dragRef.current = {
				startX: clientX,
				startY: clientY,
				startTop: pos.top,
				startLeft: pos.left,
			};
			setDragging(true);
		},
		[pos],
	);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if ((e.target as HTMLElement).closest(".toolbar-grip")) {
				startDrag(e.clientX, e.clientY);
			}
		},
		[startDrag],
	);

	const handleTouchStart = useCallback(
		(e: React.TouchEvent) => {
			if ((e.target as HTMLElement).closest(".toolbar-grip")) {
				startDrag(e.touches[0].clientX, e.touches[0].clientY);
			}
		},
		[startDrag],
	);

	useEffect(() => {
		if (!dragging) return;
		const maxX = window.innerWidth - (toolbarRef.current?.offsetWidth ?? 220);
		const maxY = window.innerHeight - (toolbarRef.current?.offsetHeight ?? 40);

		function onMove(e: MouseEvent) {
			const dx = e.clientX - dragRef.current.startX;
			const dy = e.clientY - dragRef.current.startY;
			setPos({
				top: Math.max(0, Math.min(dragRef.current.startTop + dy, maxY)),
				left: Math.max(0, Math.min(dragRef.current.startLeft + dx, maxX)),
			});
		}
		function onTouchMove(e: TouchEvent) {
			const dx = e.touches[0].clientX - dragRef.current.startX;
			const dy = e.touches[0].clientY - dragRef.current.startY;
			setPos({
				top: Math.max(0, Math.min(dragRef.current.startTop + dy, maxY)),
				left: Math.max(0, Math.min(dragRef.current.startLeft + dx, maxX)),
			});
		}
		function onEnd() {
			setDragging(false);
			const snapped = snapPos(posRef.current.top, posRef.current.left);
			setPos(snapped);
			setSnapTween(true);
			setTimeout(() => setSnapTween(false), 180);
			try {
				localStorage.setItem("client_toolbar_x", String(snapped.left));
				localStorage.setItem("client_toolbar_y", String(snapped.top));
			} catch {}
		}
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onEnd);
		window.addEventListener("touchmove", onTouchMove, { passive: true });
		window.addEventListener("touchend", onEnd);
		return () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onEnd);
			window.removeEventListener("touchmove", onTouchMove);
			window.removeEventListener("touchend", onEnd);
		};
		// biome-ignore lint/correctness/useExhaustiveDependencies: snapPos is a pure helper that reads neither state nor props, and being a function declaration its identity changes every render. Depending on it would re-bind the drag listeners on every mousemove.
	}, [dragging, snapPos]);

	return (
		<>
			{pos ? (
				<div
					ref={toolbarRef}
					className="fixed z-[9999] rounded-2xl shadow-2xl px-1.5 py-1.5 select-none backdrop-blur-2xl"
					style={{
						top: pos?.top ?? 8,
						left: pos?.left ?? 8,
						transition: snapTween
							? "top 0.18s ease-out, left 0.18s ease-out"
							: undefined,
						background:
							"linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))",
						border: "1px solid rgba(255,255,255,0.14)",
						boxShadow:
							"0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 0 24px rgba(255,255,255,0.04)",
					}}
				>
					<div className="flex items-center gap-1 sm:gap-1.5">
						<ToolbarBtn href="/" label={tToolbar("home")}>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								role="img"
								aria-label={tToolbar("home")}
							>
								<title>{tToolbar("home")}</title>
								<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
								<polyline points="9 22 9 12 15 12 15 22" />
							</svg>
						</ToolbarBtn>
						<ToolbarBtn
							onClick={() => window.location.reload()}
							label={tToolbar("reload")}
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								role="img"
								aria-label={tToolbar("reload")}
							>
								<title>{tToolbar("reload")}</title>
								<polyline points="23 4 23 10 17 10" />
								<polyline points="1 20 1 14 7 14" />
								<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
							</svg>
						</ToolbarBtn>
						<ToolbarBtn
							onClick={toggleFullscreen}
							label={
								isFullscreen
									? tToolbar("fullscreenExit")
									: tToolbar("fullscreen")
							}
						>
							{isFullscreen ? (
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									role="img"
									aria-label={tToolbar("fullscreenExit")}
								>
									<title>{tToolbar("fullscreenExit")}</title>
									<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
								</svg>
							) : (
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									role="img"
									aria-label={tToolbar("fullscreen")}
								>
									<title>{tToolbar("fullscreen")}</title>
									<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
								</svg>
							)}
						</ToolbarBtn>
						<div
							className="h-8 sm:h-9 rounded-xl flex items-center justify-center px-2"
							style={{
								border:
									"1px solid color-mix(in srgb, var(--color-primary, #eeb425) 50%, transparent)",
								background:
									"color-mix(in srgb, var(--color-primary, #eeb425) 14%, rgba(255,255,255,0.05))",
								boxShadow: "inset 0 1px 0 rgba(255,255,255,0.20)",
							}}
							role="status"
							aria-label={
								emulatorOk === null
									? tToolbar("emulatorUnknown")
									: emulatorOk
										? tToolbar("emulatorOnline")
										: tToolbar("emulatorOffline")
							}
							title={
								emulatorOk === null
									? tToolbar("emulatorUnknown")
									: emulatorOk
										? tToolbar("emulatorOnline")
										: tToolbar("emulatorOffline")
							}
						>
							<span className="relative flex h-2.5 w-2.5">
								{emulatorOk === null ? (
									<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-muted-foreground ring-2 ring-muted-foreground/30" />
								) : emulatorOk ? (
									<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success ring-2 ring-success/30 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
								) : (
									<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive ring-2 ring-destructive/30 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
								)}
							</span>
						</div>
						<div
							className="relative h-8 sm:h-9 px-2 sm:px-2.5 rounded-xl flex items-center justify-center gap-1.5 select-none cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0"
							style={{
								border:
									"1px solid color-mix(in srgb, var(--color-primary, #eeb425) 85%, white)",
								background:
									"linear-gradient(180deg, color-mix(in srgb, var(--color-primary, #eeb425) 92%, white), var(--color-primary, #eeb425) 55%, color-mix(in srgb, var(--color-primary, #eeb425) 60%, black))",
								color:
									"var(--button-text-color-readable, var(--button-text-color, #1a1a2e))",
								boxShadow:
									"0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 4px rgba(0,0,0,0.12)",
							}}
							role="status"
							aria-label={tToolbar("onlineUsers")}
							onMouseEnter={() => {
								setShowOnlineUsers(true);
								refreshOnlineUsers();
							}}
							onMouseLeave={() => setShowOnlineUsers(false)}
						>
							<span className="relative flex h-2 w-2">
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-background/80 opacity-75" />
								<span className="relative inline-flex rounded-full h-2 w-2 bg-background shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
							</span>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								role="img"
								aria-label={tToolbar("onlineUsers")}
							>
								<title>{tToolbar("onlineUsers")}</title>
								<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
								<circle cx="12" cy="7" r="4" />
							</svg>
							<span className="text-[10px] sm:text-xs font-bold">
								{onlineCount}
							</span>
							{showOnlineUsers && onlineUsers.length > 0 && (
								<span className="absolute left-1/2 -translate-x-1/2 -top-10 max-w-[200px] rounded-md bg-foreground backdrop-blur px-2 py-1 text-[10px] font-bold text-background shadow-lg pointer-events-none whitespace-normal text-center">
									{onlineUsers.slice(0, 8).join(", ")}
									{onlineUsers.length > 8
										? ` +${onlineUsers.length - 8} more`
										: ""}
								</span>
							)}
						</div>
						{/* biome-ignore lint/a11y/noStaticElementInteractions: grip handle explicitly initiates a drag (mouse+touch) and is not a button */}
						<div
							className="toolbar-grip h-8 sm:h-9 px-1.5 rounded-xl flex items-center justify-center cursor-grab active:cursor-grabbing touch-none opacity-60 hover:opacity-100 transition-opacity duration-200"
							style={{
								border: "1px solid rgba(255,255,255,0.18)",
								background: "rgba(255,255,255,0.06)",
								color: "rgba(255,255,255,0.85)",
							}}
							title={tToolbar("dragToMove")}
							onMouseDown={handleMouseDown}
							onTouchStart={handleTouchStart}
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								role="img"
								aria-label={tToolbar("dragToMove")}
							>
								<title>{tToolbar("dragToMove")}</title>
								<circle cx="9" cy="5" r="1" />
								<circle cx="15" cy="5" r="1" />
								<circle cx="9" cy="12" r="1" />
								<circle cx="15" cy="12" r="1" />
								<circle cx="9" cy="19" r="1" />
								<circle cx="15" cy="19" r="1" />
							</svg>
						</div>
						<ToolbarBtn
							onClick={() => void signOutAndRevokeTicket()}
							label={tToolbar("logout")}
						>
							<LogOut size={14} />
						</ToolbarBtn>
						<ToolbarBtn
							onClick={() => setBarHidden(true)}
							label={tToolbar("hide")}
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								role="img"
								aria-label={tToolbar("hide")}
							>
								<title>{tToolbar("hide")}</title>
								<path d="M9 18l6-6-6-6" />
							</svg>
						</ToolbarBtn>
					</div>
				</div>
			) : null}

			{barHidden ? (
				<button
					type="button"
					onPointerDown={(e) => {
						e.preventDefault();
						setBarHidden(false);
					}}
					className="fixed z-[9999] h-8 rounded-xl flex items-center justify-center px-2 cursor-pointer transition-all duration-200 opacity-80 hover:opacity-100 hover:-translate-y-0.5 active:translate-y-0 active:scale-90"
					style={{
						top: pos?.top ?? 8,
						left: pos?.left ?? 8,
						border:
							"1px solid color-mix(in srgb, var(--color-primary, #eeb425) 85%, white)",
						background:
							"linear-gradient(180deg, color-mix(in srgb, var(--color-primary, #eeb425) 92%, white), var(--color-primary, #eeb425) 55%, color-mix(in srgb, var(--color-primary, #eeb425) 60%, black))",
						color:
							"var(--button-text-color-readable, var(--button-text-color, #1a1a2e))",
						boxShadow:
							"0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 4px rgba(0,0,0,0.12)",
					}}
					aria-label={tToolbar("show")}
					title={tToolbar("show")}
				>
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						role="img"
						aria-label={tToolbar("show")}
					>
						<title>{tToolbar("show")}</title>
						<path d="M15 18l-6-6 6-6" />
					</svg>
				</button>
			) : null}

			<div
				className="relative w-screen h-screen overflow-hidden"
				style={{ backgroundColor: "var(--color-background)" }}
			>
				<iframe
					id="nitro"
					src={clientSrc}
					className={`absolute inset-0 w-full h-full border-0 m-0 p-0 overflow-hidden ${
						dragging ? "pointer-events-none" : "pointer-events-auto"
					}`}
					title={hotelName}
					allow="autoplay; gamepad; fullscreen"
					referrerPolicy="no-referrer"
					loading="eager"
					fetchPriority={"high" as const}
				/>
			</div>
		</>
	);
}
