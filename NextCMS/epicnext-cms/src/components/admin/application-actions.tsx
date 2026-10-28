"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import {
	approveApplication,
	dismissApplication,
} from "@/actions/admin-applications";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";

export function ApplicationActions({ id }: { id: string }) {
	const t = useTranslations("pages.admin.applications");
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const { confirm, dialog: confirmDialog } = useConfirmDialog();

	async function handleApprove() {
		const ok = await confirm({
			title: t("approve"),
			description: t("confirmApprove"),
			confirmLabel: t("approve"),
			variant: "default",
		});
		if (!ok) return;
		startTransition(async () => {
			const fd = new FormData();
			fd.set("id", id);
			await approveApplication(fd);
			router.refresh();
		});
	}

	async function handleReject() {
		const ok = await confirm({
			title: t("reject"),
			description: t("confirmReject"),
			confirmLabel: t("reject"),
			variant: "danger",
		});
		if (!ok) return;
		startTransition(async () => {
			const fd = new FormData();
			fd.set("id", id);
			await dismissApplication(fd);
			router.refresh();
		});
	}

	return (
		<div className="flex gap-2">
			{confirmDialog}
			<Button
				type="button"
				variant="default"
				size="sm"
				disabled={pending}
				onClick={handleApprove}
			>
				{t("approve")}
			</Button>
			<Button
				type="button"
				variant="destructive"
				size="sm"
				disabled={pending}
				onClick={handleReject}
			>
				{t("reject")}
			</Button>
		</div>
	);
}
