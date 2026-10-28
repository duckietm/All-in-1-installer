import { asc, count, eq, inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { disbandGuild, updateGuild } from "@/actions/admin-guilds";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { db, Guilds, GuildsForumsThreads, GuildsMembers, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function AdminGuildDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.USERS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const canEdit = canAccess(permissions, PERMS.USERS_EDIT, session.user.rank);
	const t = await getTranslations("pages.admin.guilds");
	const { id: rawId } = await params;
	const id = Number(rawId);
	if (!Number.isFinite(id) || id <= 0) notFound();

	const [guild] = await db
		.select({
			id: Guilds.id,
			name: Guilds.name,
			description: Guilds.description,
			userId: Guilds.userId,
			roomId: Guilds.roomId,
			badge: Guilds.badge,
			dateCreated: Guilds.dateCreated,
			state: Guilds.state,
			forum: Guilds.forum,
			readForum: Guilds.readForum,
			postMessages: Guilds.postMessages,
			postThreads: Guilds.postThreads,
			modForum: Guilds.modForum,
		})
		.from(Guilds)
		.where(eq(Guilds.id, id))
		.limit(1);
	if (!guild) notFound();

	const [ownerRows, members, memberCountRows, threadCountRows] =
		await Promise.all([
			db
				.select({ id: User.id, username: User.username })
				.from(User)
				.where(eq(User.id, guild.userId))
				.limit(1)
				.catch(() => []),
			db
				.select({
					userId: GuildsMembers.userId,
					levelId: GuildsMembers.levelId,
					memberSince: GuildsMembers.memberSince,
				})
				.from(GuildsMembers)
				.where(eq(GuildsMembers.guildId, id))
				.orderBy(asc(GuildsMembers.levelId), asc(GuildsMembers.memberSince))
				.limit(100)
				.catch(() => []),
			db
				.select({ total: count() })
				.from(GuildsMembers)
				.where(eq(GuildsMembers.guildId, id))
				.catch(() => [{ total: 0 }]),
			db
				.select({ total: count() })
				.from(GuildsForumsThreads)
				.where(eq(GuildsForumsThreads.guildId, id))
				.catch(() => [{ total: 0 }]),
		]);

	const owner = ownerRows[0] ?? null;
	const memberCount = Number(memberCountRows[0]?.total ?? 0);
	const threadCount = Number(threadCountRows[0]?.total ?? 0);

	const memberUserIds = members.map((m) => m.userId).filter((uid) => uid > 0);
	const memberUsers =
		memberUserIds.length > 0
			? await db
					.select({ id: User.id, username: User.username })
					.from(User)
					.where(inArray(User.id, memberUserIds))
					.catch(() => [])
			: [];
	const usernameById = new Map(memberUsers.map((u) => [u.id, u.username]));

	return (
		<main className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex items-center gap-4">
					{guild.badge ? (
						<img
							src={`https://habbo-stories-content.s3.amazonaws.com/badge-part-images/${guild.badge}.gif`}
							alt=""
							width={64}
							height={64}
							className="h-16 w-16 object-contain"
						/>
					) : null}
					<div>
						<h1 className="m-0 text-xl font-bold">
							{guild.name || `#${guild.id}`}
						</h1>
						<p className="muted m-0 text-sm">#{guild.id}</p>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button variant="ghost" size="sm" asChild>
						<Link href="/admin/guilds">{t("back")}</Link>
					</Button>
					<Button variant="ghost" size="sm" asChild>
						<Link href={`/guilds/${guild.id}`} target="_blank">
							{t("viewPublic")}
						</Link>
					</Button>
					{canEdit ? (
						<form action={disbandGuild}>
							<input type="hidden" name="id" value={guild.id} />
							<Button
								type="submit"
								variant="ghost"
								size="sm"
								style={{ color: "var(--admin-error)" }}
							>
								{t("disband")}
							</Button>
						</form>
					) : null}
				</div>
			</div>

			{guild.description ? (
				<p className="text-sm text-[var(--admin-text-muted)]">
					{guild.description}
				</p>
			) : null}

			{canEdit ? (
				<section>
					<h2 className="admin-section-title">{t("edit")}</h2>
					<form action={updateGuild} className="space-y-3">
						<input type="hidden" name="id" value={guild.id} />
						<div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
							<div>
								<label htmlFor="guild-name" className="text-xs muted">
									{t("formName")}
								</label>
								<input
									id="guild-name"
									type="text"
									name="name"
									maxLength={50}
									defaultValue={guild.name}
									className="w-full rounded border bg-[var(--admin-card)] px-3 py-1.5 text-sm"
								/>
							</div>
							<div>
								<label htmlFor="guild-description" className="text-xs muted">
									{t("formDescription")}
								</label>
								<input
									id="guild-description"
									type="text"
									name="description"
									maxLength={250}
									defaultValue={guild.description}
									className="w-full rounded border bg-[var(--admin-card)] px-3 py-1.5 text-sm"
								/>
							</div>
							<div>
								<label htmlFor="guild-state" className="text-xs muted">
									{t("formState")}
								</label>
								<select
									id="guild-state"
									name="state"
									defaultValue={guild.state}
									className="w-full rounded border bg-[var(--admin-card)] px-3 py-1.5 text-sm"
								>
									<option value="0">0 — Normal</option>
									<option value="1">1 — Locked</option>
									<option value="2">2 — Exclusive</option>
								</select>
							</div>
							<div>
								<label htmlFor="guild-forum" className="text-xs muted">
									{t("formForum")}
								</label>
								<select
									id="guild-forum"
									name="forum"
									defaultValue={guild.forum}
									className="w-full rounded border bg-[var(--admin-card)] px-3 py-1.5 text-sm"
								>
									<option value="0">0 — Off</option>
									<option value="1">1 — On</option>
								</select>
							</div>
							<div>
								<label htmlFor="guild-readForum" className="text-xs muted">
									{t("formReadForum")}
								</label>
								<select
									id="guild-readForum"
									name="readForum"
									defaultValue={guild.readForum}
									className="w-full rounded border bg-[var(--admin-card)] px-3 py-1.5 text-sm"
								>
									<option value="EVERYONE">EVERYONE</option>
									<option value="OWNER">OWNER</option>
									<option value="ADMIN">ADMIN</option>
									<option value="MEMBER">MEMBER</option>
									<option value="NONE">NONE</option>
								</select>
							</div>
							<div>
								<label htmlFor="guild-postMessages" className="text-xs muted">
									{t("formPostMessages")}
								</label>
								<select
									id="guild-postMessages"
									name="postMessages"
									defaultValue={guild.postMessages}
									className="w-full rounded border bg-[var(--admin-card)] px-3 py-1.5 text-sm"
								>
									<option value="EVERYONE">EVERYONE</option>
									<option value="OWNER">OWNER</option>
									<option value="ADMIN">ADMIN</option>
									<option value="MEMBER">MEMBER</option>
									<option value="NONE">NONE</option>
								</select>
							</div>
							<div>
								<label htmlFor="guild-postThreads" className="text-xs muted">
									{t("formPostThreads")}
								</label>
								<select
									id="guild-postThreads"
									name="postThreads"
									defaultValue={guild.postThreads}
									className="w-full rounded border bg-[var(--admin-card)] px-3 py-1.5 text-sm"
								>
									<option value="EVERYONE">EVERYONE</option>
									<option value="OWNER">OWNER</option>
									<option value="ADMIN">ADMIN</option>
									<option value="MEMBER">MEMBER</option>
									<option value="NONE">NONE</option>
								</select>
							</div>
							<div>
								<label htmlFor="guild-modForum" className="text-xs muted">
									{t("formModForum")}
								</label>
								<select
									id="guild-modForum"
									name="modForum"
									defaultValue={guild.modForum}
									className="w-full rounded border bg-[var(--admin-card)] px-3 py-1.5 text-sm"
								>
									<option value="ADMINS">ADMINS</option>
									<option value="OWNER">OWNER</option>
									<option value="MEMBER">MEMBER</option>
									<option value="NONE">NONE</option>
								</select>
							</div>
						</div>
						<Button type="submit" variant="ghost" size="sm">
							{t("save")}
						</Button>
					</form>
				</section>
			) : null}

			<div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
				<div className="admin-card">
					<div className="text-xs muted">{t("colOwner")}</div>
					<div>
						{owner ? (
							<Link href={`/admin/users/show/${owner.id}`}>
								{owner.username}
							</Link>
						) : (
							`#${guild.userId}`
						)}
					</div>
				</div>
				<div className="admin-card">
					<div className="text-xs muted">{t("colMembers")}</div>
					<div className="text-lg font-bold">{memberCount}</div>
				</div>
				<div className="admin-card">
					<div className="text-xs muted">{t("colThreads")}</div>
					<div className="text-lg font-bold">{threadCount}</div>
				</div>
				<div className="admin-card">
					<div className="text-xs muted">{t("colCreated")}</div>
					<div>{formatDate(new Date(guild.dateCreated * 1000))}</div>
				</div>
				<div className="admin-card">
					<div className="text-xs muted">{t("colRoom")}</div>
					<div>
						{guild.roomId > 0 ? (
							<Link href={`/admin/rooms/show/${guild.roomId}`}>
								#{guild.roomId}
							</Link>
						) : (
							"—"
						)}
					</div>
				</div>
			</div>

			<section>
				<h2 className="admin-section-title">
					{t("members")} ({Math.min(members.length, memberCount)})
				</h2>
				{members.length === 0 ? (
					<div className="admin-empty">{t("noMembers")}</div>
				) : (
					<div className="admin-card overflow-x-auto" style={{ padding: 0 }}>
						<table>
							<thead>
								<tr>
									<th>{t("colUser")}</th>
									<th>{t("colLevel")}</th>
									<th>{t("colJoined")}</th>
								</tr>
							</thead>
							<tbody>
								{members.map((m) => (
									<tr key={`${m.userId}-${m.memberSince}`}>
										<td>
											<Link href={`/admin/users/show/${m.userId}`}>
												{usernameById.get(m.userId) ?? `#${m.userId}`}
											</Link>
										</td>
										<td className="muted">{m.levelId}</td>
										<td className="muted">
											{formatDate(new Date(m.memberSince * 1000))}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</main>
	);
}
