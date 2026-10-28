import { desc, inArray } from "drizzle-orm";
import { Camera } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { deletePhoto } from "@/actions/admin-photos";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { StatusCard } from "@/components/admin/dashboard";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import { CameraWeb, db, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { getCachedAdminCount } from "@/lib/services/admin-stats";

export default async function AdminPhotos({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PAGES_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.photos");
	const parsed = parseListParams(new URLSearchParams(await searchParams));

	const total = await getCachedAdminCount(CameraWeb, "camera_web").catch(
		() => 0,
	);
	const pagination = calcPagination(total, parsed.page, parsed.perPage || 24);

	let photos: (typeof CameraWeb.$inferSelect)[] = [];
	try {
		photos = await db
			.select()
			.from(CameraWeb)
			.orderBy(desc(CameraWeb.timestamp))
			.limit(pagination.perPage)
			.offset(pagination.offset);
	} catch {
		photos = [];
	}

	const userIds = [...new Set(photos.map((p) => p.userId))];
	const users =
		userIds.length > 0
			? await db
					.select({ id: User.id, username: User.username })
					.from(User)
					.where(inArray(User.id, userIds))
					.catch(() => [])
			: [];
	const usernameById = new Map(users.map((u) => [u.id, u.username]));

	const uniqueRooms = new Set(photos.map((p) => p.roomId)).size;
	const uniqueUsers = new Set(photos.map((p) => p.userId)).size;
	const canEdit = canAccess(permissions, PERMS.PAGES_EDIT, session.user.rank);

	return (
		<AdminPageShell icon={Camera} title={t("title")} subtitle={t("subtitle")}>
			<p className="m-0 mb-4 text-sm text-[var(--admin-text-muted)]">
				{t("purgeHint")}
			</p>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard label={t("photosShown")} value={photos.length} icon="📸" />
				<StatusCard
					label={t("rooms")}
					value={uniqueRooms}
					hint={t("distinctRooms")}
					icon="🚪"
				/>
				<StatusCard
					label={t("users")}
					value={uniqueUsers}
					hint={t("distinctPhotographers")}
					icon="👤"
				/>
				<StatusCard label={t("total")} value={total} icon="🗂" />
			</div>

			<section className="mt-2">
				<h2 className="admin-section-title">{t("recentPhotos")}</h2>
				{photos.length === 0 ? (
					<div className="admin-empty">{t("noPhotos")}</div>
				) : (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						{photos.map((p) => {
							const username = usernameById.get(p.userId) ?? `#${p.userId}`;
							return (
								<div
									key={String(p.id)}
									className="admin-card"
									style={{ padding: 0, overflow: "hidden" }}
								>
									<img
										src={p.url}
										alt={t("photoAlt", { id: String(p.id) })}
										style={{
											width: "100%",
											height: 200,
											objectFit: "cover",
											display: "block",
											background: "#f1f5f9",
										}}
									/>
									<div style={{ padding: "0.85rem 1.05rem 1.05rem" }}>
										<div
											style={{
												display: "flex",
												justifyContent: "space-between",
												gap: "0.5rem",
												alignItems: "baseline",
											}}
										>
											<strong>#{String(p.id)}</strong>
											<Link
												href={`/admin/rooms/edit/${p.roomId}`}
												className="text-sm theme-text-muted dark:theme-text-muted hover:underline"
											>
												{t("colRoom")} {p.roomId}
											</Link>
										</div>
										<p
											className="text-xs theme-text-muted dark:theme-text-muted"
											style={{ margin: "0.3rem 0 0" }}
										>
											<Link
												href={`/admin/users/show/${p.userId}`}
												className="hover:underline"
											>
												{t("byUser", { username })}
											</Link>{" "}
											· {formatDate(new Date(p.timestamp * 1000))}
										</p>
										{canEdit ? (
											<form
												action={deletePhoto}
												style={{ marginTop: "0.75rem" }}
											>
												<input type="hidden" name="id" value={String(p.id)} />
												<Button type="submit" variant="destructive">
													{t("delete")}
												</Button>
											</form>
										) : null}
									</div>
								</div>
							);
						})}
					</div>
				)}
				{pagination.lastPage > 1 ? (
					<p className="text-sm text-muted-foreground mt-4">
						{t("pageOf", {
							page: pagination.page,
							last: pagination.lastPage,
							total,
						})}
					</p>
				) : null}
			</section>
		</AdminPageShell>
	);
}
