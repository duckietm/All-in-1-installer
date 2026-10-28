import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { StatusCard } from "@/components/admin/dashboard";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { db, WebsiteAds } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { AdsTable } from "./ads-table";

export default async function AdminAds() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PAGES_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.ads");
	let ads: (typeof WebsiteAds.$inferSelect)[] = [];
	try {
		ads = await db
			.select()
			.from(WebsiteAds)
			.orderBy(desc(WebsiteAds.id))
			.limit(500);
	} catch {
		ads = [];
	}

	const latest = ads[0]?.createdAt ? formatDate(ads[0].createdAt, "date") : "—";

	return (
		<main>
			<div className="flex justify-end mb-6">
				<Button variant="default" asChild>
					<Link href="/admin/ads/new">+ {t("newAd")}</Link>
				</Button>
			</div>

			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard label={t("adsCount")} value={ads.length} icon="🖼️" />
				<StatusCard
					label={t("latest")}
					value={latest}
					hint={t("mostRecentAd")}
					icon="🕒"
				/>
			</div>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("allAds")}</h2>
				{ads.length === 0 ? (
					<div className="admin-empty">{t("noAds")}</div>
				) : (
					<AdsTable
						ads={ads.map((ad) => ({
							id: String(ad.id),
							image: ad.image,
							createdAt: ad.createdAt ? formatDate(ad.createdAt, "date") : null,
						}))}
					/>
				)}
			</section>
		</main>
	);
}
