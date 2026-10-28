import { asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { PublicLoadError } from "@/components/public/load-error";
import { ContentCard, EmptyState, StatBlock } from "@/components/public/ui";
import { UserAvatarThumbnail } from "@/components/shared/user-avatar-thumbnail";
import { db, Guilds, GuildsMembers, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { publicReadFailure } from "@/lib/services/public-read";

type GuildView = {
	id: number;
	name: string;
	description: string;
	badge: string;
	userId: number;
	dateCreated: number;
};

type MemberView = {
	userId: number;
	username: string;
	look: string;
	motto: string;
	memberSince: number;
	isOwner: boolean;
};

export default async function GuildPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const t = await getTranslations("pages.guild");
	const { id } = await params;
	const guildId = Number(id);
	if (!Number.isInteger(guildId) || guildId <= 0) notFound();

	let guild: GuildView | null = null;
	try {
		const [row] = await db
			.select({
				id: Guilds.id,
				name: Guilds.name,
				description: Guilds.description,
				badge: Guilds.badge,
				userId: Guilds.userId,
				dateCreated: Guilds.dateCreated,
			})
			.from(Guilds)
			.where(eq(Guilds.id, guildId))
			.limit(1);
		guild = row ?? null;
	} catch (error) {
		publicReadFailure("guild.detail")(error);
		return (
			<section className="page-grid">
				<ContentCard>
					<PublicLoadError href={`/guilds/${guildId}`} />
				</ContentCard>
			</section>
		);
	}

	if (!guild) notFound();

	// Members come from guilds_members; there is no relation in the schema, so we
	// join the users table manually by id.
	let membersFailed = false;
	let memberRows: { userId: number; memberSince: number }[] = [];
	try {
		memberRows = await db
			.select({
				userId: GuildsMembers.userId,
				memberSince: GuildsMembers.memberSince,
			})
			.from(GuildsMembers)
			.where(eq(GuildsMembers.guildId, guild.id))
			.orderBy(asc(GuildsMembers.memberSince))
			.limit(200);
	} catch (error) {
		publicReadFailure("guild.members")(error);
		membersFailed = true;
		memberRows = [];
	}

	const memberIds = Array.from(
		new Set(
			[guild.userId, ...memberRows.map((m) => m.userId)].filter((v) => v > 0),
		),
	);

	let users: { id: number; username: string; look: string; motto: string }[] =
		[];
	try {
		users = memberIds.length
			? await db
					.select({
						id: User.id,
						username: User.username,
						look: User.look,
						motto: User.motto,
					})
					.from(User)
					.where(inArray(User.id, memberIds))
			: [];
	} catch (error) {
		publicReadFailure("guild.member-users")(error);
		membersFailed = true;
		users = [];
	}

	const usersById = new Map(users.map((u) => [u.id, u]));
	const sinceById = new Map(memberRows.map((m) => [m.userId, m.memberSince]));

	const guildOwnerUserId = guild.userId;

	const members: MemberView[] = memberIds
		.map((uid) => {
			const u = usersById.get(uid);
			if (!u) return null;
			return {
				userId: u.id,
				username: u.username,
				look: u.look,
				motto: u.motto,
				memberSince: sinceById.get(uid) ?? 0,
				isOwner: uid === guildOwnerUserId,
			};
		})
		.filter((m): m is MemberView => m !== null)
		// Owner first, then by join date.
		.sort((a, b) => {
			if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
			return a.memberSince - b.memberSince;
		});

	const created = formatDate(new Date(guild.dateCreated * 1000), "date");

	return (
		<section className="page-grid">
			<p style={{ margin: 0 }}>
				<Link href="/guilds">{t("allGuilds")}</Link>
			</p>

			<ContentCard>
				<div
					style={{ display: "flex", gap: "1.25rem", alignItems: "flex-start" }}
				>
					{guild.badge ? (
						<img
							src={`https://habbo-stories-content.s3.amazonaws.com/badge-part-images/${guild.badge}.gif`}
							alt={`${guild.name} badge`}
							width={48}
							height={48}
							style={{ flex: "0 0 auto" }}
						/>
					) : null}
					<div style={{ minWidth: 0, flex: 1 }}>
						<h1 style={{ margin: "0 0 0.35rem" }}>
							{guild.name || t("unnamedGuild")}
						</h1>
						<p style={{ margin: 0 }}>
							{guild.description || (
								<span className="muted">{t("noDescription")}</span>
							)}
						</p>
					</div>
				</div>

				<div className="stat-grid" style={{ marginTop: "1.1rem" }}>
					<StatBlock
						icon="👥"
						value={membersFailed ? "—" : members.length}
						label={
							members.length === 1 ? t("memberSingular") : t("memberPlural")
						}
					/>
					{created ? (
						<StatBlock icon="📅" value={created} label={t("founded")} />
					) : null}
					<StatBlock
						icon="🚪"
						value={
							<Link
								href={`/guilds/${guild.id}/forum`}
								style={{ textDecoration: "none" }}
							>
								{t("forumLink")}
							</Link>
						}
						label={t("discussion")}
					/>
				</div>
			</ContentCard>

			<ContentCard
				icon="👥"
				title={t("membersTitle")}
				subtitle={
					membersFailed
						? undefined
						: `${members.length} ${members.length === 1 ? t("memberLowerSingular") : t("memberLowerPlural")}`
				}
				padded={members.length === 0 || membersFailed}
			>
				{membersFailed && <PublicLoadError href={`/guilds/${guild.id}`} />}
				{members.length === 0 ? (
					membersFailed ? null : (
						<EmptyState icon="👥">{t("noMembers")}</EmptyState>
					)
				) : (
					<div className="card-grid sm-2 lg-3" style={{ padding: "1rem" }}>
						{members.map((m) => (
							<div
								key={m.userId}
								className="card hover"
								style={{
									display: "flex",
									gap: "0.85rem",
									alignItems: "center",
								}}
							>
								<UserAvatarThumbnail
									figure={m.look}
									alt={`${m.username} avatar`}
								/>
								<div style={{ minWidth: 0 }}>
									<h3 style={{ margin: "0 0 0.2rem", fontSize: "1rem" }}>
										<Link href={`/u/${m.username}`}>{m.username}</Link>
									</h3>
									{m.isOwner ? (
										<span
											className="online-badge online"
											style={{ marginBottom: "0.25rem" }}
										>
											👑 {t("owner")}
										</span>
									) : null}
									<p
										className="muted"
										style={{ margin: m.isOwner ? "0.25rem 0 0" : 0 }}
									>
										{m.motto || t("noMotto")}
									</p>
								</div>
							</div>
						))}
					</div>
				)}
			</ContentCard>
		</section>
	);
}
