"use client";

import { useTranslations } from "next-intl";
import { useOnlineCount } from "@/lib/online-count-sse";

/**
 * Live online user counter. Shares a single SSE connection (see
 * `useOnlineCount`) so the whole page uses one socket instead of one per
 * counter.
 */
export function LiveOnlineCount({
	initial,
	hotelName,
}: {
	initial: number;
	hotelName: string;
}) {
	const t = useTranslations("header");
	const count = useOnlineCount(initial);

	return <>{t("online", { count, hotel: hotelName })}</>;
}
