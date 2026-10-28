"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { deleteAd } from "@/actions/admin-ads";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";

export type AdRow = {
	id: string;
	image: string;
	createdAt: string | null;
};

export function AdsTable({ ads }: { ads: AdRow[] }) {
	const t = useTranslations("pages.admin.ads");
	const { run, isPending } = useServerAction();
	const { confirm, dialog: confirmDialog } = useConfirmDialog();

	async function handleDelete(row: AdRow) {
		const ok = await confirm({
			title: t("delete"),
			description: t("confirmDelete"),
			confirmLabel: t("delete"),
			cancelLabel: t("form.cancel"),
		});
		if (!ok) return;
		run(() => deleteAd({ id: row.id }), {
			successMessage: t("deleteSuccess"),
			errorMessage: t("deleteError"),
		});
	}

	return (
		<>
			{confirmDialog}
			<table>
				<thead>
					<tr>
						<th>{t("colPreview")}</th>
						<th>{t("colImage")}</th>
						<th>{t("colCreated")}</th>
						<th>{t("colActions")}</th>
					</tr>
				</thead>
				<tbody>
					{ads.map((ad) => (
						<tr key={ad.id}>
							<td>
								<img
									src={ad.image}
									alt=""
									style={{ maxHeight: 40, maxWidth: 120 }}
								/>
							</td>
							<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
								<code>{ad.image}</code>
							</td>
							<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
								{ad.createdAt ?? "—"}
							</td>
							<td>
								<div className="flex items-center gap-2">
									<Link href={`/admin/ads/${ad.id}`}>{t("edit")}</Link>
									<Button
										type="button"
										variant="destructive"
										size="sm"
										disabled={isPending}
										onClick={() => handleDelete(ad)}
									>
										<Trash2 className="h-3.5 w-3.5" />
										{t("delete")}
									</Button>
								</div>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</>
	);
}
