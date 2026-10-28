"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { deleteAd } from "@/actions/admin-ads";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";

export function EditAdDeleteButton({ id }: { id: string }) {
	const t = useTranslations("pages.admin.ads");
	const { run, isPending } = useServerAction();
	const { confirm, dialog: confirmDialog } = useConfirmDialog();

	async function handleDelete() {
		const ok = await confirm({
			title: t("delete"),
			description: t("confirmDelete"),
			confirmLabel: t("delete"),
			cancelLabel: t("form.cancel"),
		});
		if (!ok) return;
		run(() => deleteAd({ id }), {
			successMessage: t("deleteSuccess"),
			errorMessage: t("deleteError"),
			redirectTo: "/admin/ads",
		});
	}

	return (
		<>
			{confirmDialog}
			<Button
				type="button"
				variant="destructive"
				disabled={isPending}
				onClick={handleDelete}
			>
				<Trash2 className="mr-2 h-4 w-4" />
				{t("form.deleteAd")}
			</Button>
		</>
	);
}
