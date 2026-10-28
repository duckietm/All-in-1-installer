import { Newspaper } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createArticle } from "@/actions/admin-articles";
import { ArticleForm } from "@/components/admin/article-form";
import Link from "@/components/link";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function NewArticle({
	searchParams,
}: {
	searchParams: Promise<{ error?: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.NEWS_EDIT, session.user.rank)) {
		redirect("/admin");
	}

	const { error } = await searchParams;
	const t = await getTranslations("pages.admin.articles");

	return (
		<main>
			<div className="flex items-center gap-3 mb-6">
				<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--admin-accent)]/20 to-[var(--admin-accent)]/5 grid place-items-center">
					<Newspaper size={20} className="text-[var(--admin-accent)]" />
				</div>
				<div>
					<h1 className="m-0 text-xl font-extrabold text-[var(--admin-text)]">
						{t("form.title")}
					</h1>
					<p className="m-0 text-xs text-[var(--admin-text-muted)] mt-0.5">
						<Link href="/admin/articles">← {t("title")}</Link>
					</p>
				</div>
			</div>
			{error ? (
				<p className="text-xs text-[var(--admin-error)] dark:text-[var(--admin-error)] mb-4">
					Error: {error}
				</p>
			) : null}
			<ArticleForm userId={String(session.user.id)} action={createArticle} />
		</main>
	);
}
