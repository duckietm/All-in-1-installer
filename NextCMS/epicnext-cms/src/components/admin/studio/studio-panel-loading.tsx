"use client";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
export function StudioPanelLoading({
	onClose,
	drawer = false,
}: {
	onClose: () => void;
	drawer?: boolean;
}) {
	const t = useTranslations("pages.admin.housekeeping");
	const status = (
		<p role="status" className="flex items-center gap-2">
			<Loader2 className="size-4 animate-spin" aria-hidden="true" />
			{t("loading")}
		</p>
	);
	if (drawer)
		return (
			<aside className="absolute inset-y-0 right-0 z-20 flex h-full w-[min(28rem,100%)] shrink-0 flex-col gap-4 border-l border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 shadow-xl lg:static lg:shadow-none">
				{status}
				<Button variant="outline" onClick={onClose}>
					{t("cancel")}
				</Button>
			</aside>
		);
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("loading")}</DialogTitle>
				</DialogHeader>
				{status}
				<Button variant="outline" onClick={onClose}>
					{t("cancel")}
				</Button>
			</DialogContent>
		</Dialog>
	);
}
