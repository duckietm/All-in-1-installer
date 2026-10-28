import { eq } from "drizzle-orm";
import Image from "next/image";
import type { Session } from "next-auth";
import { getTranslations } from "next-intl/server";
import { signOutAndRevokeTicket } from "@/actions/sessions";
import { HeaderUserIdentity } from "@/components/header-user-identity";
import Link from "@/components/link";
import { LiveOnlineCount } from "@/components/live-online-count";
import { RoomQuickEntry } from "@/components/room-quick-entry";
import { UserAvatarThumbnail } from "@/components/shared/user-avatar-thumbnail";
import { db, User, UsersCurrency } from "@/lib/db";
import { resolveHotelName } from "@/lib/hotel-name";
import { loadMessengerCounts } from "@/lib/messenger-counts";
import { canAccess, getApiAdminContext, PERMS } from "@/lib/permissions";
import { logServerError } from "@/lib/server-log";
import { cachedOnlineCount } from "@/lib/services/public-counters";

function Currency({
	icon,
	amount,
	label,
}: {
	icon: string;
	amount: number;
	label: string;
}) {
	const textColor =
		"var(--color-navbar-text-readable, var(--color-navbar-text))";
	const valueColor =
		"var(--color-navbar-text-readable, var(--color-navbar-text, var(--color-text)))";

	return (
		<div className="flex gap-x-1 sm:gap-x-2 items-center">
			<div
				className={`h-[20px] w-[20px] sm:h-[25px] sm:w-[25px] rounded-full outline-offset-[3px] ${icon}`}
			/>
			<div style={{ color: textColor }}>
				<span
					className="font-semibold text-xs sm:text-sm"
					style={{ color: valueColor }}
				>
					{amount.toLocaleString()}
				</span>{" "}
				<span className="hidden sm:inline text-xs">{label}</span>
			</div>
		</div>
	);
}

export async function TopHeader({ session }: { session: Session | null }) {
	if (!session?.user?.id) return null;
	const notificationText = await getTranslations("pages.notifications");
	const t = await getTranslations("header");
	const id = Number(session.user.id);

	let credits = 0;
	let duckets = 0;
	let diamonds = 0;
	let look = "";
	let showAdmin = false;
	let showMod = false;
	let hotelName = "";
	let online = 0;
	let friendRequestUsers: {
		id: number;
		username: string;
		look: string;
	}[] = [];

	// One round of queries instead of five sequential ones: the header is on
	// every authenticated page, so each extra round-trip is paid on every view.
	const [wallet, ctx, name, onlineCount, messenger] = await Promise.all([
		(async () => {
			try {
				const [user, currencies] = await Promise.all([
					db
						.select({ credits: User.credits, look: User.look })
						.from(User)
						.where(eq(User.id, id))
						.limit(1),
					db
						.select({ type: UsersCurrency.type, amount: UsersCurrency.amount })
						.from(UsersCurrency)
						.where(eq(UsersCurrency.userId, id)),
				]);
				return user[0]
					? { credits: user[0].credits, look: user[0].look, currencies }
					: null;
			} catch (error) {
				logServerError("top-header.wallet_failed", error, { userId: id });
				return null;
			}
		})(),
		getApiAdminContext().catch(() => null),
		resolveHotelName().catch(() => ""),
		cachedOnlineCount().catch((error) => {
			logServerError("top-header.online_count_failed", error);
			return 0;
		}),
		// Shared with the navigation (one set of queries per request).
		loadMessengerCounts(id),
	]);

	if (wallet) {
		credits = wallet.credits;
		look = wallet.look;
		for (const c of wallet.currencies) {
			if (c.type === 0) duckets = c.amount;
			if (c.type === 5) diamonds = c.amount;
		}
	}
	if (ctx) {
		showAdmin = canAccess(
			ctx.permissions,
			PERMS.ADMIN_DASHBOARD,
			ctx.session.user.rank,
		);
		showMod =
			canAccess(ctx.permissions, PERMS.MOD_DASHBOARD, ctx.session.user.rank) ||
			canAccess(
				ctx.permissions,
				PERMS.MODERATION_VIEW,
				ctx.session.user.rank,
			) ||
			canAccess(ctx.permissions, PERMS.MOD_CFH_VIEW, ctx.session.user.rank) ||
			canAccess(ctx.permissions, PERMS.MOD_ACTIONS, ctx.session.user.rank);
	}
	hotelName = name;
	online = onlineCount;
	friendRequestUsers = messenger.requests;

	// The count and the rows are the same question, so derive it from the rows.
	const pendingFriendRequests = messenger.requests.length;
	const textColor =
		"var(--color-navbar-text-readable, var(--color-navbar-text, var(--color-text)))";
	const unreadMessages = messenger.unreadMessages;

	const totalNotifications = unreadMessages + pendingFriendRequests;

	return (
		<div style={{ backgroundColor: "var(--color-navbar)" }}>
			<div className="max-w-7xl min-h-[44px] sm:min-h-[60px] px-2 sm:px-4 flex items-center justify-between mx-auto">
				<div className="flex flex-wrap items-center gap-x-1.5 sm:gap-x-4 md:gap-x-6">
					<div
						className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 rounded-full"
						style={{
							background: "rgba(255,255,255,0.08)",
							border: "1px solid rgba(255,255,255,0.10)",
						}}
					>
						<span
							className="text-[10px] sm:text-sm font-bold tracking-wide"
							style={{ color: "rgba(255,255,255,0.9)" }}
						>
							<LiveOnlineCount initial={online} hotelName={hotelName} />
						</span>
					</div>

					<Link
						href="/client"
						className="hidden sm:flex items-center gap-1.5 rounded-xl border py-1.5 px-3 font-extrabold text-xs transition-all duration-200 hover:scale-[1.02] active:scale-95 shadow-lg"
						style={{
							background: "var(--color-primary)",
							color: "var(--color-primary-foreground)",
							borderColor:
								"color-mix(in srgb, var(--color-primary) 20%, transparent)",
							boxShadow:
								"0 4px 24px color-mix(in srgb, var(--color-primary) 35%, transparent)",
						}}
					>
						<Image
							src="/assets/images/EnterHubbly.png"
							alt=""
							width={14}
							height={14}
							unoptimized
						/>
						{t("enter")}
					</Link>

					<RoomQuickEntry />

					<Currency
						icon="nav-credit-icon"
						amount={credits}
						label={t("credits")}
					/>
					<Currency
						icon="nav-ducket-icon"
						amount={duckets}
						label={t("duckets")}
					/>
					<Currency
						icon="nav-diamond-icon"
						amount={diamonds}
						label={t("diamonds")}
					/>
				</div>

				<div className="flex items-center gap-x-0.5 sm:gap-x-3">
					<form
						action="/search"
						method="GET"
						className="hidden sm:flex items-center gap-1"
					>
						<input
							type="text"
							name="q"
							placeholder={t("searchUsers")}
							className="w-24 rounded-lg border px-2 py-1 text-xs font-medium transition-all focus:w-32"
							style={{
								background: "var(--color-background)",
								color: "var(--color-text-readable)",
								borderColor:
									"color-mix(in srgb, var(--color-text-muted) 25%, transparent)",
							}}
						/>
					</form>
					<Link
						href="/messages"
						className="relative flex items-center gap-1 rounded-lg px-1.5 sm:px-2 py-1.5 transition-colors hover:bg-background/10"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{ color: textColor }}
							role="img"
							aria-label={notificationText("title")}
						>
							<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
							<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
						</svg>
						{totalNotifications > 0 && (
							<span
								className="absolute -top-1 -right-1 flex min-w-[16px] h-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none"
								style={{
									background: "var(--color-danger)",
									color: "white",
								}}
							>
								{totalNotifications > 99 ? "99+" : totalNotifications}
							</span>
						)}
					</Link>

					{showAdmin || showMod ? (
						<details className="relative">
							<summary
								className="list-none cursor-pointer font-semibold text-xs sm:text-sm [&::-webkit-details-marker]:hidden"
								style={{ color: textColor }}
							>
								<span className="hidden sm:inline">{t("staff")}</span>
								<span className="sm:hidden">{t("staff")}</span>
							</summary>
							<div
								role="menu"
								className="dropdown-menu absolute right-0 top-full mt-0.5 min-w-[180px] rounded-xl z-50 py-2"
							>
								{showMod ? (
									<Link href="/mod" className="dropdown-item" role="menuitem">
										{t("modPanel")}
									</Link>
								) : null}
								{showAdmin ? (
									<>
										<Link
											href="/admin"
											className="dropdown-item"
											role="menuitem"
										>
											{t("adminPanel")}
										</Link>
										<Link
											href="/admin/commandocentrum"
											className="dropdown-item"
											role="menuitem"
										>
											{t("commandCenter")}
										</Link>
										<Link
											href="/admin/logs"
											className="dropdown-item"
											role="menuitem"
										>
											{t("logs")}
										</Link>
									</>
								) : null}
								<Link href="/logo" className="dropdown-item" role="menuitem">
									{t("logoGenerator")}
								</Link>
							</div>
						</details>
					) : null}

					<details className="relative">
						<summary
							aria-label={t("userMenu")}
							className="list-none cursor-pointer flex items-center [&::-webkit-details-marker]:hidden"
						>
							<HeaderUserIdentity
								figure={look}
								username={session.user.name ?? ""}
								textColor={textColor}
							/>
						</summary>
						<div
							role="menu"
							className="dropdown-menu fixed sm:absolute right-2 sm:right-0 top-auto sm:top-full mt-0.5 min-w-[200px] rounded-xl z-50 py-2"
						>
							<Link href="/me" className="dropdown-item" role="menuitem">
								{t("myDashboard")}
							</Link>
							<Link
								href={`/u/${session.user.name}`}
								className="dropdown-item"
								role="menuitem"
							>
								{t("myProfile")}
							</Link>
							<Link
								href="/notifications"
								className="dropdown-item"
								role="menuitem"
							>
								{notificationText("title")}
							</Link>
							<Link href="/settings" className="dropdown-item" role="menuitem">
								{t("userSettings")}
							</Link>
							<Link
								href="/settings/2fa"
								className="dropdown-item"
								role="menuitem"
							>
								{t("twoFactor")}
							</Link>
							<Link
								href="/settings/sessions"
								className="dropdown-item"
								role="menuitem"
							>
								{t("loginActivity")}
							</Link>

							{pendingFriendRequests > 0 && (
								<>
									<div
										className="h-px my-1 mx-3"
										style={{
											backgroundColor:
												"color-mix(in srgb, var(--color-text-muted) 12%, transparent)",
										}}
									/>
									<div className="px-3 py-1.5">
										<p
											className="text-xs font-bold mb-1"
											style={{ color: "var(--color-text-muted)" }}
										>
											{t("friendRequests")} ({pendingFriendRequests})
										</p>
										{friendRequestUsers.slice(0, 3).map((u) => (
											<Link
												key={u.id}
												href="/messages"
												className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-background/10"
											>
												<UserAvatarThumbnail
													figure={u.look}
													alt=""
													options={{ direction: 2 }}
												/>
												<span style={{ color: textColor }}>{u.username}</span>
											</Link>
										))}
										{friendRequestUsers.length > 3 && (
											<p
												className="text-xs mt-1 opacity-60"
												style={{ color: textColor }}
											>
												{t("more", { count: friendRequestUsers.length - 3 })}
											</p>
										)}
									</div>
								</>
							)}

							<div
								className="h-px my-1 mx-3"
								style={{
									backgroundColor:
										"color-mix(in srgb, var(--color-text-muted) 12%, transparent)",
								}}
							/>
							<form action={signOutAndRevokeTicket}>
								<button
									type="submit"
									role="menuitem"
									className="dropdown-item w-full text-center mx-1 rounded-lg"
									style={{
										backgroundColor:
											"color-mix(in srgb, var(--button-danger-color) 12%, transparent)",
										color: "var(--button-danger-color)",
										border: "none",
										cursor: "pointer",
										width: "calc(100% - 8px)",
									}}
								>
									{t("logout")}
								</button>
							</form>
						</div>
					</details>
				</div>
			</div>
		</div>
	);
}
