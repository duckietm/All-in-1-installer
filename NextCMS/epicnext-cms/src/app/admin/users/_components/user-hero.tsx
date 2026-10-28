"use client";
import {
	ArrowLeftRight,
	DoorOpen,
	Eye,
	MessageSquare,
	Pencil,
	Shield,
	Wifi,
	WifiOff,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb";
import { UserWatchToggle } from "@/components/admin/user-watch-toggle";
import Link from "@/components/link";
import { CurrencyIcon } from "@/components/shared/currency-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format-date";
import { avatarImageOnError, getAvatarUrl } from "@/lib/imager";
import { userDetailHref, userListHref } from "../user-list-navigation";

interface UserHeroProps {
	user: {
		id: number;
		username: string;
		motto: string;
		look: string;
		rank: number;
		credits: number;
		pixels: number;
		online: string;
		permission: { rankName: string };
		twoFactorConfirmed: number;
	};
	diamonds: number;
	duckets: number;
	roomCount: number;
	chatCount: number;
	tradeCount: number;
	isOnline: boolean;
	activeBan: boolean;
	mode: "show" | "edit";
	canEdit: boolean;
	canViewLogs?: boolean;
	/** When non-null, render the watch toggle with this initial state. */
	watching?: boolean | null;
}

export function UserHero({
	user,
	diamonds,
	duckets,
	roomCount,
	chatCount,
	tradeCount,
	isOnline,
	activeBan,
	mode,
	canEdit,
	watching,
	canViewLogs = true,
}: UserHeroProps) {
	const t = useTranslations("pages.admin.users.presentation");
	const params = useSearchParams();
	const list = params.get("list") ?? "";
	const listHref = userListHref(list);
	return (
		<>
			<AdminBreadcrumb
				items={[
					{ label: t("users"), href: listHref },
					{ label: user.username },
					{ label: mode === "edit" ? t("edit") : t("view") },
				]}
			/>

			<div className="relative rounded-xl border bg-gradient-to-r from-card to-muted/30 p-6">
				<div className="flex flex-col sm:flex-row items-start gap-5">
					{/* Avatar */}
					<div className="relative shrink-0">
						<img
							src={getAvatarUrl(user.look, { headDirection: 2, direction: 2 })}
							alt={user.username}
							onError={avatarImageOnError}
							className="h-28 rounded-lg border bg-card shadow-sm"
							style={{ imageRendering: "pixelated" }}
						/>
						<span
							className={`absolute -top-1 -right-1 flex h-4 w-4 ${isOnline ? "" : "opacity-50"}`}
						>
							{isOnline && (
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--admin-success)] opacity-75" />
							)}
							<span
								className={`relative inline-flex rounded-full h-4 w-4 border-2 border-card ${isOnline ? "bg-[var(--admin-success-subtle)]" : "bg-[var(--admin-text-muted)]"}`}
							/>
						</span>
					</div>

					{/* Info */}
					<div className="flex-1 min-w-0 space-y-2">
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="text-3xl font-bold tracking-tight">
								{user.username}
							</h1>
							<Badge variant="secondary" className="text-xs">
								ID: {user.id}
							</Badge>
							{/* Mode switch buttons */}
							{mode === "show" && canEdit && (
								<Button variant="outline" size="sm" asChild className="ml-2">
									<Link href={userDetailHref(user.id, "edit", list)}>
										<Pencil className="mr-1.5 h-3.5 w-3.5" /> {t("edit")}
									</Link>
								</Button>
							)}
							{mode === "edit" && (
								<Button variant="outline" size="sm" asChild className="ml-2">
									<Link href={userDetailHref(user.id, "show", list)}>
										<Eye className="mr-1.5 h-3.5 w-3.5" /> {t("view")}
									</Link>
								</Button>
							)}
							{watching != null && (
								<UserWatchToggle
									targetUserId={user.id}
									username={user.username}
									initialWatching={watching}
								/>
							)}
						</div>

						{user.motto && (
							<p className="text-muted-foreground italic">
								&ldquo;{user.motto}&rdquo;
							</p>
						)}

						<div className="flex flex-wrap items-center gap-2">
							<Badge>
								{user.permission.rankName || t("rank", { rank: user.rank })}
							</Badge>
							<Badge
								variant={isOnline ? "default" : "outline"}
								className={isOnline ? "bg-[var(--admin-success-subtle)]" : ""}
							>
								{isOnline ? (
									<>
										<Wifi className="mr-1 h-3 w-3" /> {t("online")}
									</>
								) : (
									<>
										<WifiOff className="mr-1 h-3 w-3" /> {t("offline")}
									</>
								)}
							</Badge>
							{activeBan && <Badge variant="destructive">{t("banned")}</Badge>}
							{user.twoFactorConfirmed ? (
								<Badge
									variant="outline"
									className="border-[var(--admin-success-border)] text-[var(--admin-success)]"
								>
									<Shield className="mr-1 h-3 w-3" /> 2FA
								</Badge>
							) : null}
						</div>

						{/* Currency row */}
						<div className="flex flex-wrap gap-3 pt-1">
							<div className="flex items-center gap-1.5 text-sm">
								<CurrencyIcon kind="credits" size={18} />
								<span className="font-semibold">
									{formatNumber(user.credits)}
								</span>
								<span className="text-muted-foreground text-xs">
									{t("credits")}
								</span>
							</div>
							<div className="flex items-center gap-1.5 text-sm">
								<CurrencyIcon kind="diamonds" size={18} />
								<span className="font-semibold">{formatNumber(diamonds)}</span>
								<span className="text-muted-foreground text-xs">
									{t("diamonds")}
								</span>
							</div>
							<div className="flex items-center gap-1.5 text-sm">
								<CurrencyIcon kind="duckets" size={18} />
								<span className="font-semibold">{formatNumber(duckets)}</span>
								<span className="text-muted-foreground text-xs">
									{t("duckets")}
								</span>
							</div>
							<div className="flex items-center gap-1.5 text-sm">
								<CurrencyIcon kind="pixels" size={18} />
								<span className="font-semibold">
									{formatNumber(user.pixels)}
								</span>
								<span className="text-muted-foreground text-xs">
									{t("pixels")}
								</span>
							</div>
						</div>
					</div>

					{/* Quick stats cards */}
					<div className="grid grid-cols-3 gap-2 shrink-0">
						<Link
							href={`/admin/rooms?search=${user.username}`}
							className="rounded-lg border bg-card px-3 py-2 text-center hover:shadow-md transition-shadow"
						>
							<DoorOpen className="h-4 w-4 mx-auto text-muted-foreground" />
							<p className="text-lg font-bold">{roomCount}</p>
							<p className="text-[10px] text-muted-foreground">{t("rooms")}</p>
						</Link>
						{canViewLogs && (
							<div className="rounded-lg border bg-card px-3 py-2 text-center">
								<MessageSquare className="h-4 w-4 mx-auto text-muted-foreground" />
								<p className="text-lg font-bold">{formatNumber(chatCount)}</p>
								<p className="text-[10px] text-muted-foreground">
									{t("messages")}
								</p>
							</div>
						)}
						{canViewLogs && (
							<div className="rounded-lg border bg-card px-3 py-2 text-center">
								<ArrowLeftRight className="h-4 w-4 mx-auto text-muted-foreground" />
								<p className="text-lg font-bold">{tradeCount}</p>
								<p className="text-[10px] text-muted-foreground">
									{t("trades")}
								</p>
							</div>
						)}
					</div>
				</div>
			</div>
		</>
	);
}
