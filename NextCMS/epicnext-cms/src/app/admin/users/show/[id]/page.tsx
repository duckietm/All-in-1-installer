import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { getWatchedUserIds } from "@/lib/services/watch";
import { UserAccountInfo } from "../../_components/user-account-info";
import { UserBadgesReadonly } from "../../_components/user-badges-readonly";
import { UserHero } from "../../_components/user-hero";
import { UserOperationalOverview } from "../../_components/user-operational-overview";
import { loadUserById } from "../../_lib/load-user";
import { loadUserOverview } from "../../_lib/load-user-overview";
import { UserActivityLog } from "../../[id]/user-activity-log";
import { UserQuickActions } from "../../[id]/user-quick-actions";
import { UserRooms } from "../../[id]/user-rooms";

export default async function UserShowPage({
	params,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const { id } = await params;
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.USERS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.users.detail");
	const overviewT = await getTranslations("pages.admin.users.overview");
	const canEdit = canAccess(permissions, PERMS.USERS_EDIT, session.user.rank);
	const canViewLogs = canAccess(
		permissions,
		PERMS.LOGS_VIEW,
		session.user.rank,
	);
	const data = await loadUserById(id, {
		logs: canViewLogs,
		bans: canAccess(permissions, PERMS.BANS_VIEW, session.user.rank),
	});
	const [overview, watched] = await Promise.all([
		loadUserOverview(data.user.id, permissions, session.user.rank),
		getWatchedUserIds(session.user.id),
	]);

	return (
		<div className="space-y-6">
			<UserHero
				user={data.user}
				diamonds={data.diamonds}
				duckets={data.duckets}
				roomCount={data.roomCount}
				chatCount={data.chatCount}
				canViewLogs={canViewLogs && !data.activityUnavailable}
				tradeCount={data.tradeCount}
				isOnline={data.isOnline}
				activeBan={!!data.activeBan}
				mode="show"
				canEdit={canEdit}
				watching={watched.has(data.user.id)}
			/>

			<div
				className={
					canEdit
						? "grid gap-6 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px]"
						: undefined
				}
			>
				<Tabs defaultValue="overview" className="space-y-4 min-w-0">
					<TabsList className="h-auto flex-wrap justify-start">
						<TabsTrigger value="overview">{overviewT("title")}</TabsTrigger>
						<TabsTrigger value="info">{t("tabInfo")}</TabsTrigger>
						<TabsTrigger value="badges">
							{t("tabBadges", { count: data.user.badges.length })}
						</TabsTrigger>
						<TabsTrigger value="rooms">
							{t("tabRooms", { count: data.roomCount })}
						</TabsTrigger>
						{canViewLogs && (
							<TabsTrigger value="activity">{t("tabActivity")}</TabsTrigger>
						)}
					</TabsList>

					<TabsContent value="overview">
						<UserOperationalOverview sections={overview} />
					</TabsContent>

					<TabsContent value="info">
						<UserAccountInfo user={data.user} />
					</TabsContent>

					<TabsContent value="badges">
						<div className="rounded-lg border bg-card p-4">
							<h3 className="text-sm font-semibold mb-3">
								{t("tabBadges", { count: data.user.badges.length })}
							</h3>
							<UserBadgesReadonly badges={data.user.badges} />
						</div>
					</TabsContent>

					<TabsContent value="rooms">
						<UserRooms rooms={data.userRooms} />
					</TabsContent>

					{canViewLogs && (
						<TabsContent value="activity">
							{data.activityUnavailable ? (
								<p
									role="status"
									className="rounded-lg border bg-card p-4 text-sm text-destructive"
								>
									{overviewT("error")}
								</p>
							) : (
								<UserActivityLog
									chatLogs={data.chatLogs}
									commandLogs={data.commandLogs}
								/>
							)}
						</TabsContent>
					)}
				</Tabs>

				{canEdit && (
					<aside className="lg:sticky lg:top-4 lg:self-start">
						<UserQuickActions
							userId={data.user.id}
							username={data.user.username}
							isOnline={data.isOnline}
						/>
					</aside>
				)}
			</div>
		</div>
	);
}
