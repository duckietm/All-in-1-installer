import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { uploadBadge } from "@/actions/admin-badge-upload";
import { giveBadge } from "@/actions/admin-badges";
import { Button } from "@/components/ui/button";
import { db, WebsiteBadges } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export const metadata = { title: "Badges" };

export default async function AdminBadges({
	searchParams,
}: {
	searchParams: Promise<{ uploaded?: string; error?: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.CATALOG_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.badges");
	const { uploaded, error } = await searchParams;

	let badges: (typeof WebsiteBadges.$inferSelect)[] = [];
	try {
		badges = await db
			.select()
			.from(WebsiteBadges)
			.orderBy(asc(WebsiteBadges.badgeName))
			.limit(500);
	} catch {
		badges = [];
	}

	return (
		<main>
			{uploaded && (
				<div className="mb-4 p-3 rounded-lg bg-[var(--admin-success-subtle)] text-[var(--admin-success)] dark:text-[var(--admin-success)] text-xs">
					{t("uploadedMessage", { code: uploaded })}
				</div>
			)}
			{error && (
				<div className="mb-4 p-3 rounded-lg bg-[var(--admin-error-subtle)] text-[var(--admin-error)] dark:text-[var(--admin-error)] text-xs">
					{t("errorMessage", { error })}
				</div>
			)}

			<section className="mt-6">
				<h2 className="admin-section-title">{t("uploadTitle")}</h2>
				<p className="text-xs text-[var(--admin-text-muted)] -mt-2 mb-3">
					{t("uploadSubtitle")}
				</p>
				<form action={uploadBadge} className="admin-card">
					<div className="flex gap-2 flex-wrap items-center">
						<input type="file" name="file" accept=".gif,.png" required />
						<input
							name="code"
							placeholder={t("badgeCodePlaceholder")}
							required
							maxLength={64}
							pattern="[A-Za-z0-9_-]{1,64}"
							className="flex-1 min-w-[160px]"
						/>
						<Button type="submit" variant="default">
							{t("uploadButton")}
						</Button>
					</div>
				</form>
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("giveTitle")}</h2>
				<form action={giveBadge} className="admin-card">
					<div className="flex gap-2 flex-wrap items-center">
						<input
							name="userId"
							type="number"
							min={1}
							placeholder={t("userIdPlaceholder")}
							required
						/>
						<input
							name="code"
							placeholder={t("badgeCodePlaceholder")}
							required
							maxLength={32}
							className="flex-1 min-w-[160px]"
							list="badge-codes"
						/>
						<datalist id="badge-codes">
							{badges.map((b) => (
								<option key={String(b.id)} value={b.badgeKey}>
									{b.badgeName}
								</option>
							))}
						</datalist>
						<Button type="submit" variant="default">
							{t("giveButton")}
						</Button>
					</div>
				</form>
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">
					{t("catalogueTitle")} ({badges.length})
				</h2>
				{badges.length === 0 ? (
					<div className="admin-empty">{t("noBadges")}</div>
				) : (
					<div className="overflow-x-auto">
						<table>
							<thead>
								<tr>
									<th>{t("colCode")}</th>
									<th>{t("colName")}</th>
									<th>{t("colDescription")}</th>
									<th>{t("colIcon")}</th>
									<th />
								</tr>
							</thead>
							<tbody>
								{badges.map((b) => (
									<tr key={String(b.id)}>
										<td>
											<code>{b.badgeKey}</code>
										</td>
										<td>{b.badgeName}</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted">
											{b.badgeDescription}
										</td>
										<td>
											<img
												src={`/assets/images/badges/${b.badgeKey}.gif`}
												alt={b.badgeName}
												className="h-6 w-6 object-contain"
											/>
										</td>
										<td>
											<form
												action={giveBadge}
												className="flex gap-2 items-center"
											>
												<input type="hidden" name="code" value={b.badgeKey} />
												<input
													name="userId"
													type="number"
													min={1}
													placeholder={t("userIdPlaceholder")}
													required
													className="w-[90px]"
												/>
												<Button type="submit" variant="outline">
													{t("giveButton")}
												</Button>
											</form>
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
