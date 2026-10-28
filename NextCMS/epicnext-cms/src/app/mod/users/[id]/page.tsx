import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { AvatarImage } from "@/components/shared/avatar-image";
import { Badge } from "@/components/ui/badge";
import { requireModPermission } from "@/lib/admin/guard";
import { db, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { PERMS } from "@/lib/permissions";

export default async function ModUserDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	await requireModPermission([PERMS.MOD_USERS_VIEW, PERMS.USERS_VIEW]);
	const t = await getTranslations("pages.mod");
	const { id: rawId } = await params;
	const id = Number(rawId);
	if (!Number.isFinite(id) || id <= 0) notFound();

	const [user] = await db
		.select({
			id: User.id,
			username: User.username,
			rank: User.rank,
			online: User.online,
			motto: User.motto,
			look: User.look,
			accountCreated: User.accountCreated,
			lastLogin: User.lastLogin,
			lastOnline: User.lastOnline,
		})
		.from(User)
		.where(eq(User.id, id))
		.limit(1);
	if (!user) notFound();

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex items-center gap-4">
					<AvatarImage
						figure={user.look}
						options={{ size: "m", direction: 2, headDirection: 2 }}
						alt=""
						width={64}
						height={110}
						className="rounded"
					/>
					<div>
						<h2 className="admin-section-title m-0">{user.username}</h2>
						<p className="mt-1 text-sm text-[var(--admin-text-muted)]">
							#{user.id} · {t("usersRank")} {user.rank}
						</p>
						<div className="mt-2 flex gap-2">
							{user.online === "1" ? (
								<Badge className="bg-[var(--admin-success)]">Online</Badge>
							) : (
								<Badge variant="outline">Offline</Badge>
							)}
						</div>
					</div>
				</div>
				<div className="flex gap-3">
					<Link
						href="/mod/users"
						className="text-sm text-muted-foreground underline-offset-2 hover:underline"
					>
						← {t("nav.users")}
					</Link>
					<Link
						href={`/u/${user.username}`}
						className="text-sm text-[var(--admin-accent)] underline-offset-2 hover:underline"
					>
						{t("usersPublicProfile")}
					</Link>
				</div>
			</div>

			<div
				className="rounded-lg border border-[var(--admin-info-border)] bg-[var(--admin-info-subtle)] px-4 py-3 text-sm"
				role="status"
			>
				{t("usersPiiNote")}
			</div>

			<div className="admin-card grid gap-4 p-5 sm:grid-cols-2">
				<div>
					<p className="m-0 text-xs uppercase tracking-wide text-muted-foreground">
						Motto
					</p>
					<p className="m-0 mt-1">{user.motto || "—"}</p>
				</div>
				<div>
					<p className="m-0 text-xs uppercase tracking-wide text-muted-foreground">
						{t("usersJoined")}
					</p>
					<p className="m-0 mt-1">
						{user.accountCreated > 0
							? formatDate(new Date(user.accountCreated * 1000), "date")
							: "—"}
					</p>
				</div>
				<div>
					<p className="m-0 text-xs uppercase tracking-wide text-muted-foreground">
						{t("usersLastLogin")}
					</p>
					<p className="m-0 mt-1">
						{user.lastLogin
							? formatDate(new Date(user.lastLogin * 1000), "datetime")
							: "—"}
					</p>
				</div>
				<div>
					<p className="m-0 text-xs uppercase tracking-wide text-muted-foreground">
						{t("usersLastOnline")}
					</p>
					<p className="m-0 mt-1">
						{user.lastOnline > 0
							? formatDate(new Date(user.lastOnline * 1000), "datetime")
							: "—"}
					</p>
				</div>
			</div>
		</div>
	);
}
