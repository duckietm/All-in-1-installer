"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";
import { retryDelivery } from "./retry-action";
export function DeliveryRetry({ id }: { id: string }) {
	const t = useTranslations("pages.admin.deliveries");
	const { run, isPending } = useServerAction();
	return (
		<Button
			variant="outline"
			disabled={isPending}
			onClick={() =>
				run(() => retryDelivery(id), {
					successMessage: t("retried"),
					errorMessage: t("retryError"),
				})
			}
		>
			{t("retry")}
		</Button>
	);
}
