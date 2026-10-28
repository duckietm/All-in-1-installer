import { Package } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createShopArticle } from "@/actions/admin-shop";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function NewShopArticle() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SHOP_EDIT, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.shop");

	return (
		<main>
			<div className="flex items-center gap-3 mb-6">
				<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--admin-accent)]/20 to-[var(--admin-accent)]/5 grid place-items-center">
					<Package size={20} className="text-[var(--admin-accent)]" />
				</div>
				<div>
					<h1 className="m-0 text-xl font-extrabold text-[var(--admin-text)]">
						{t("newPackageTitle")}
					</h1>
					<Link
						href="/admin/shop"
						className="text-xs text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
					>
						← {t("backToShop")}
					</Link>
				</div>
			</div>

			<form action={createShopArticle} className="admin-card">
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<input
						name="name"
						placeholder={t("form.namePlaceholder")}
						required
						maxLength={255}
						className="w-full"
					/>
					<input
						name="info"
						placeholder={t("form.infoPlaceholder")}
						maxLength={255}
						className="w-full"
					/>
					<input
						name="icon"
						placeholder={t("form.iconPlaceholder")}
						maxLength={255}
						className="w-full"
					/>
					<input
						name="color"
						placeholder={t("form.colorPlaceholder")}
						maxLength={255}
						className="w-full"
					/>
					<input
						name="costs"
						type="number"
						min={0}
						placeholder={t("form.costsPlaceholder")}
						required
						className="w-full"
					/>
					<input
						name="credits"
						type="number"
						min={0}
						placeholder={t("form.creditsPlaceholder")}
						className="w-full"
					/>
					<input
						name="duckets"
						type="number"
						min={0}
						placeholder={t("form.ducketsPlaceholder")}
						className="w-full"
					/>
					<input
						name="diamonds"
						type="number"
						min={0}
						placeholder={t("form.diamondsPlaceholder")}
						className="w-full"
					/>
					<input
						name="giveRank"
						type="number"
						min={0}
						placeholder={t("form.giveRankPlaceholder")}
						className="w-full"
					/>
					<input
						name="badges"
						placeholder={t("form.badgesPlaceholder")}
						maxLength={255}
						className="w-full"
					/>
					<input
						name="position"
						type="number"
						min={0}
						placeholder={t("form.positionPlaceholder")}
						defaultValue={0}
						className="w-full"
					/>
				</div>
				<div className="mt-6 text-right">
					<Button type="submit" variant="default">
						{t("form.create")}
					</Button>
				</div>
			</form>
		</main>
	);
}
