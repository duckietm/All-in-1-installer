"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { deleteArticle } from "@/actions/admin-articles";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import Link from "@/components/link";

export function ArticleCard({
	id,
	title,
	image,
	createdAt,
	author,
}: {
	id: string;
	title: string;
	image: string;
	createdAt: string | null;
	author?: string;
}) {
	const t = useTranslations("pages.admin.articles");
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const { confirm, dialog: confirmDialog } = useConfirmDialog();

	async function handleDelete() {
		const ok = await confirm({
			title: t("delete"),
			description: t("confirmDelete", { title }),
			confirmLabel: t("delete"),
			variant: "danger",
		});
		if (!ok) return;
		startTransition(async () => {
			const fd = new FormData();
			fd.set("id", id);
			await deleteArticle(fd);
			router.refresh();
		});
	}

	return (
		<div className="admin-card overflow-hidden flex flex-col">
			{confirmDialog}
			<div className="relative w-full aspect-[16/9] bg-[var(--admin-canvas)]">
				<img
					src={image || ""}
					alt={title}
					className="w-full h-full object-cover block"
					onError={(e) => {
						e.currentTarget.style.visibility = "hidden";
					}}
				/>
			</div>
			<div className="p-3 flex flex-col flex-1">
				<Link
					href={`/admin/articles/${id}`}
					className="font-semibold text-[var(--admin-text)] hover:text-[var(--admin-accent)] line-clamp-2"
					style={{ textDecoration: "none" }}
				>
					{title}
				</Link>
				<p className="text-xs text-[var(--admin-text-muted)] mt-1 mb-3 flex items-center gap-2 flex-wrap">
					<span>{createdAt ? createdAt.slice(0, 10) : "—"}</span>
					{author ? (
						<>
							<span>·</span>
							<span>{author}</span>
						</>
					) : null}
				</p>
				<div className="flex gap-2 mt-auto">
					<Link
						href={`/admin/articles/${id}`}
						className="btn btn-primary flex-1 text-center"
					>
						{t("edit")}
					</Link>
					<button
						type="button"
						className="btn btn-danger"
						disabled={pending}
						onClick={handleDelete}
					>
						{t("delete")}
					</button>
				</div>
			</div>
		</div>
	);
}
