import { eq } from "drizzle-orm";
import { Package } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { deleteShopArticle, updateShopArticle } from "@/actions/admin-shop";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { db, WebsiteShopArticles } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function EditShopArticle({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SHOP_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.shop");

	const { id } = await params;
	let pkg: typeof WebsiteShopArticles.$inferSelect | null = null;
	try {
		const [row] = await db
			.select()
			.from(WebsiteShopArticles)
			.where(eq(WebsiteShopArticles.id, BigInt(id)))
			.limit(1);
		pkg = row ?? null;
	} catch {
		notFound();
	}
	if (!pkg) notFound();

	return (
		<main>
			<div className="flex items-center gap-3 mb-6">
				<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--admin-accent)]/20 to-[var(--admin-accent)]/5 grid place-items-center">
					<Package size={20} className="text-[var(--admin-accent)]" />
				</div>
				<div>
					<h1 className="m-0 text-xl font-extrabold text-[var(--admin-text)]">
						{t("editPackageTitle")}
					</h1>
					<Link
						href="/admin/shop"
						className="text-xs text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
					>
						← {t("backToShop")}
					</Link>
				</div>
			</div>

			<form action={updateShopArticle} className="admin-card">
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<input type="hidden" name="id" value={String(pkg.id)} />
					<input
						name="name"
						defaultValue={pkg.name}
						placeholder={t("form.namePlaceholder")}
						required
						maxLength={255}
						className="w-full"
					/>
					<input
						name="info"
						defaultValue={pkg.info}
						placeholder={t("form.infoPlaceholder")}
						maxLength={255}
						className="w-full"
					/>
					<input
						name="icon"
						defaultValue={pkg.iconUrl}
						placeholder={t("form.iconPlaceholder")}
						maxLength={255}
						className="w-full"
					/>
					<input
						name="color"
						defaultValue={pkg.color}
						placeholder={t("form.colorPlaceholder")}
						maxLength={255}
						className="w-full"
					/>
					<input
						name="costs"
						type="number"
						min={0}
						defaultValue={pkg.costs}
						placeholder={t("form.costsPlaceholder")}
						required
						className="w-full"
					/>
					<input
						name="credits"
						type="number"
						min={0}
						defaultValue={pkg.credits ?? undefined}
						placeholder={t("form.creditsPlaceholder")}
						className="w-full"
					/>
					<input
						name="duckets"
						type="number"
						min={0}
						defaultValue={pkg.duckets ?? undefined}
						placeholder={t("form.ducketsPlaceholder")}
						className="w-full"
					/>
					<input
						name="diamonds"
						type="number"
						min={0}
						defaultValue={pkg.diamonds ?? undefined}
						placeholder={t("form.diamondsPlaceholder")}
						className="w-full"
					/>
					<input
						name="giveRank"
						type="number"
						min={0}
						defaultValue={pkg.giveRank ?? undefined}
						placeholder={t("form.giveRankPlaceholder")}
						className="w-full"
					/>
					<input
						name="badges"
						defaultValue={pkg.badges ?? ""}
						placeholder={t("form.badgesPlaceholder")}
						maxLength={255}
						className="w-full"
					/>
					<input
						name="position"
						type="number"
						min={0}
						defaultValue={pkg.position}
						placeholder={t("form.positionPlaceholder")}
						className="w-full"
					/>
				</div>
				<div className="mt-6 flex gap-2">
					<Button type="submit" variant="default">
						{t("form.save")}
					</Button>
					<form action={deleteShopArticle}>
						<input type="hidden" name="id" value={String(pkg.id)} />
						<Button type="submit" variant="destructive">
							{t("form.deletePackage")}
						</Button>
					</form>
				</div>
			</form>
		</main>
	);
}
