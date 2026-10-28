import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { getWatchedUserIds } from "@/lib/services/watch";
import { UserAccountInfo } from "../../_components/user-account-info";
import { UserHero } from "../../_components/user-hero";
import { loadUserById } from "../../_lib/load-user";
import { UserActivityLog } from "../../[id]/user-activity-log";
import { UserBadgesSection } from "../../[id]/user-badges-section";
import { UserBanSection } from "../../[id]/user-ban-section";
import { UserEditForm } from "../../[id]/user-edit-form";
import { UserQuickActions } from "../../[id]/user-quick-actions";
import { UserRooms } from "../../[id]/user-rooms";

export default async function UserEditPage({
	params,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const { id } = await params;
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.USERS_EDIT, session.user.rank)) {
		redirect("/admin");
	}

	const overviewT = await getTranslations("pages.admin.users.overview");
	const canViewLogs = canAccess(
		permissions,
		PERMS.LOGS_VIEW,
		session.user.rank,
	);
	const canViewBans = canAccess(
		permissions,
		PERMS.BANS_VIEW,
		session.user.rank,
	);
	const data = await loadUserById(id, { logs: canViewLogs, bans: canViewBans });
	const watched = await getWatchedUserIds(session.user.id);

	// Fetch rank list from permissions table for the rank dropdown
	const [rawRanks] = (await db.execute(
		sql`SELECT id, rank_name FROM permissions ORDER BY id ASC`,
	)) as unknown as [{ id: number; rank_name: string }[], unknown];
	const ranks = (rawRanks ?? []).map((r) => ({
		id: Number(r.id),
		name: String(r.rank_name || `Rank ${r.id}`),
	}));

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
				mode="edit"
				canEdit={true}
				watching={watched.has(data.user.id)}
			/>

			<div className="grid gap-6 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px]">
				<Tabs defaultValue="edit" className="space-y-4 min-w-0">
					<TabsList className="flex-wrap">
						<TabsTrigger value="edit">Edit Profile</TabsTrigger>
						{canViewBans && (
							<TabsTrigger value="bans">
								Bans
								{data.activeBan && (
									<span className="ml-1.5 flex h-2 w-2 rounded-full bg-destructive" />
								)}
							</TabsTrigger>
						)}
						<TabsTrigger value="badges">
							Badges ({data.user.badges.length})
						</TabsTrigger>
						<TabsTrigger value="rooms">Rooms ({data.roomCount})</TabsTrigger>
						{canViewLogs && (
							<TabsTrigger value="activity">Activity</TabsTrigger>
						)}
						<TabsTrigger value="info">Account Info</TabsTrigger>
					</TabsList>

					<TabsContent value="edit">
						<UserEditForm
							user={{
								id: data.user.id,
								username: data.user.username,
								mail: data.user.mail,
								rank: data.user.rank,
								motto: data.user.motto,
								credits: data.user.credits,
								pixels: data.user.pixels,
								diamonds: data.diamonds,
								duckets: data.duckets,
							}}
							ranks={ranks}
						/>
					</TabsContent>

					{canViewBans && (
						<TabsContent value="bans">
							<UserBanSection
								userId={data.user.id}
								username={data.user.username}
								bans={data.user.bansReceived.map((b) => ({
									id: b.id,
									reason: b.banReason,
									type: b.type,
									staffName: b.staff.username,
									timestamp: b.timestamp,
									banExpire: b.banExpire,
								}))}
							/>
						</TabsContent>
					)}

					<TabsContent value="badges">
						<UserBadgesSection
							userId={data.user.id}
							badges={data.user.badges.map((b) => ({
								id: b.id,
								badgeCode: b.badgeCode,
							}))}
						/>
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

					<TabsContent value="info">
						<UserAccountInfo user={data.user} />
					</TabsContent>
				</Tabs>

				<aside className="lg:sticky lg:top-4 lg:self-start">
					<UserQuickActions
						userId={data.user.id}
						username={data.user.username}
						isOnline={data.isOnline}
					/>
				</aside>
			</div>
		</div>
	);
}
