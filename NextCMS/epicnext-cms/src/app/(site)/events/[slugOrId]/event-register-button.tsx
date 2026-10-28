"use client";

import { useTranslations } from "next-intl";
import { registerForEvent } from "@/actions/events";
import { useServerAction } from "@/hooks/use-server-action";

export function EventRegisterButton({
	eventId,
	disabled,
	disabledReason,
}: {
	eventId: number;
	disabled?: boolean;
	disabledReason?: string;
}) {
	const t = useTranslations("pages.events");
	const { run, isPending } = useServerAction();

	if (disabled) {
		return (
			<p className="muted" style={{ margin: 0 }}>
				{disabledReason ?? t("cannotRegister")}
			</p>
		);
	}

	return (
		<button
			type="button"
			className="btn btn-primary"
			disabled={isPending}
			onClick={() =>
				run(() => registerForEvent({ eventId }), {
					successMessage: t("registerSuccess"),
					errorMessage: t("registerError"),
					// registerForEvent revalidates /events and /events/<id>.
					revalidated: true,
				})
			}
		>
			{isPending ? t("registering") : t("register")}
		</button>
	);
}
