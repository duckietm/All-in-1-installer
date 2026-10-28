import { asc, count } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createTag, deleteTag, updateTag } from "@/actions/admin-tags";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { db, Taggables, Tags } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

type Tag = {
	id: bigint;
	name: string;
	backgroundColor: string;
	createdAt: Date | null;
};

export default async function AdminTagsPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PAGES_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.tags");
	let tags: Tag[] = [];
	let usage = new Map<string, number>();
	let dbError = false;

	try {
		tags = await db
			.select({
				id: Tags.id,
				name: Tags.name,
				backgroundColor: Tags.backgroundColor,
				createdAt: Tags.createdAt,
			})
			.from(Tags)
			.orderBy(asc(Tags.name))
			.limit(500);

		// How many things each tag is attached to (taggables join table).
		const counts = await db
			.select({
				tagId: Taggables.tagId,
				total: count(),
			})
			.from(Taggables)
			.groupBy(Taggables.tagId);
		usage = new Map(counts.map((c) => [String(c.tagId), Number(c.total)]));
	} catch {
		dbError = true;
		tags = [];
	}

	const inUse = tags.filter((t) => (usage.get(String(t.id)) ?? 0) > 0).length;
	const unused = tags.length - inUse;

	return (
		<main>
			{dbError ? (
				<div className="admin-card" style={{ marginBottom: "1.5rem" }}>
					<p className="text-xs theme-text-muted dark:theme-text-muted m-0">
						{t("databaseError")}
					</p>
				</div>
			) : (
				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
					<StatusCard label={t("totalTags")} value={tags.length} icon="🏷️" />
					<StatusCard
						label={t("inUse")}
						value={inUse}
						hint={t("attachedToContent")}
						state={inUse > 0 ? "ok" : "neutral"}
						icon="🔗"
					/>
					<StatusCard
						label={t("unused")}
						value={unused}
						state={unused > 0 ? "warn" : "ok"}
						icon="🫙"
					/>
				</div>
			)}

			<form action={createTag} className="admin-card mb-6">
				<h3 style={{ marginTop: 0 }}>{t("addTag")}</h3>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					<div>
						<label
							htmlFor="new_name"
							style={{ display: "block", fontWeight: 700 }}
						>
							{t("name")}
						</label>
						<input
							id="new_name"
							name="name"
							placeholder={t("namePlaceholder")}
							required
							maxLength={255}
							style={{ width: "100%" }}
						/>
					</div>
					<div>
						<label
							htmlFor="new_backgroundColor"
							style={{ display: "block", fontWeight: 700 }}
						>
							{t("backgroundColour")}
						</label>
						<input
							id="new_backgroundColor"
							name="backgroundColor"
							placeholder="#888888"
							defaultValue="#888888"
							maxLength={10}
							style={{ width: "100%" }}
						/>
					</div>
				</div>
				<div style={{ marginTop: "0.75rem" }}>
					<Button type="submit" variant="default">
						{t("createTag")}
					</Button>
				</div>
			</form>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("allTags")}</h2>
				{tags.length === 0 ? (
					<div className="admin-empty">{t("noTags")}</div>
				) : (
					<table>
						<thead>
							<tr>
								<th>{t("colId")}</th>
								<th>{t("colTag")}</th>
								<th>{t("colColour")}</th>
								<th>{t("colUsedBy")}</th>
								<th>{t("colCreated")}</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{tags.map((tag) => (
								<tr key={String(tag.id)}>
									<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
										{String(tag.id)}
									</td>
									<td>
										<span
											style={{
												display: "inline-block",
												padding: "0.1rem 0.5rem",
												borderRadius: "0.4rem",
												background: tag.backgroundColor,
												color: "#fff",
											}}
										>
											{tag.name}
										</span>
									</td>
									<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
										<code>{tag.backgroundColor}</code>
									</td>
									<td>
										<span
											className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${
												(usage.get(String(tag.id)) ?? 0) > 0
													? "bg-[var(--admin-success-subtle)] text-[var(--admin-text)]"
													: "bg-[var(--admin-accent)]/18 text-[var(--admin-text)]"
											}`}
										>
											{usage.get(String(tag.id)) ?? 0}
										</span>
									</td>
									<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
										{formatDate(tag.createdAt, "date", "—")}
									</td>
									<td>
										<form
											action={updateTag}
											style={{
												display: "flex",
												gap: "0.4rem",
												alignItems: "center",
											}}
										>
											<input type="hidden" name="id" value={String(tag.id)} />
											<input
												name="name"
												defaultValue={tag.name}
												required
												maxLength={255}
												style={{ width: 140 }}
											/>
											<input
												name="backgroundColor"
												defaultValue={tag.backgroundColor}
												maxLength={10}
												className="w-[90px]"
											/>
											<Button type="submit" variant="default">
												{t("updateTag")}
											</Button>
										</form>
										<form action={deleteTag} style={{ marginTop: "0.4rem" }}>
											<input type="hidden" name="id" value={String(tag.id)} />
											<Button type="submit" variant="destructive">
												{t("deleteTag")}
											</Button>
										</form>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</section>
		</main>
	);
}
