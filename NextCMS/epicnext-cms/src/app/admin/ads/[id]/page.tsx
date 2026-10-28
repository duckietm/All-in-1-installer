import { eq } from "drizzle-orm";
import { Megaphone } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { updateAd } from "@/actions/admin-ads";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { db, WebsiteAds } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { EditAdDeleteButton } from "../edit-ad-delete-button";

export default async function EditAd({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PAGES_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const { id } = await params;
	let ad: typeof WebsiteAds.$inferSelect | null = null;
	try {
		const [row] = await db
			.select()
			.from(WebsiteAds)
			.where(eq(WebsiteAds.id, BigInt(id)))
			.limit(1);
		ad = row ?? null;
	} catch {
		notFound();
	}
	if (!ad) notFound();

	const t = await getTranslations("pages.admin.ads");

	return (
		<main>
			<div className="flex items-center gap-3 mb-6">
				<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--admin-accent)]/20 to-[var(--admin-accent)]/5 grid place-items-center">
					<Megaphone size={20} className="text-[var(--admin-accent)]" />
				</div>
				<div>
					<h1 className="m-0 text-xl font-extrabold text-[var(--admin-text)]">
						{t("edit")} #{String(ad.id)}
					</h1>
					<p className="m-0 text-xs text-[var(--admin-text-muted)] mt-0.5">
						<Link href="/admin/ads">← {t("title")}</Link>
					</p>
				</div>
			</div>
			<form action={updateAd} className="admin-card">
				<input type="hidden" name="id" value={String(ad.id)} />
				<input
					name="image"
					defaultValue={ad.image}
					placeholder={t("form.imagePlaceholder")}
					required
					maxLength={255}
				/>
				<Button type="submit" variant="default">
					{t("form.save")}
				</Button>
			</form>
			<div style={{ marginTop: "1rem" }}>
				<EditAdDeleteButton id={String(ad.id)} />
			</div>
		</main>
	);
}
