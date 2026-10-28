"use client";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useVisiblePolling } from "@/hooks/use-visible-polling";
import { adminFetch } from "@/lib/admin-fetch";

interface Status {
	hotel: { sent: boolean; checkedAt: string; reference?: string } | null;
	git: {
		enabled: boolean;
		pending: number;
		active: number;
		error?: string;
		commit?: string;
	};
}
export function CatalogSyncStatus({ canEdit }: { canEdit: boolean }) {
	const t = useTranslations("pages.admin.catalog.workspace");
	const [status, setStatus] = useState<Status | null>(null);
	const [error, setError] = useState(false);
	const [busy, setBusy] = useState(false);
	const refresh = useCallback(async () => {
		try {
			const res = await adminFetch("/cms_api/admin/catalog/status", {
				cache: "no-store",
			});
			if (!res.ok) throw Error();
			setStatus(await res.json());
			setError(false);
		} catch {
			setError(true);
		}
	}, []);
	useVisiblePolling(refresh, 15000);
	async function retry() {
		setBusy(true);
		try {
			const res = await adminFetch("/cms_api/admin/catalog/status", {
				method: "POST",
			});
			if (!res.ok) throw Error();
			await refresh();
		} catch {
			setError(true);
		} finally {
			setBusy(false);
		}
	}
	return (
		<div
			className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--admin-border)] p-3 text-xs"
			aria-live="polite"
		>
			<span>
				{t("hotel")}:{" "}
				{status?.hotel
					? t(status.hotel.sent ? "sent" : "sendFailed")
					: t("unknown")}
			</span>
			<span>
				Git:{" "}
				{status
					? t(
							!status.git.enabled
								? "disabled"
								: status.git.error
									? "exportFailed"
									: status.git.pending || status.git.active
										? "queued"
										: status.git.commit
											? "exported"
											: "unknown",
						)
					: t("unknown")}
			</span>
			{status?.hotel?.reference && <span>{status.hotel.reference}</span>}
			{canEdit && status?.hotel?.sent === false && (
				<Button size="sm" variant="outline" disabled={busy} onClick={retry}>
					{t("retryHotel")}
				</Button>
			)}
			{error && (
				<button type="button" onClick={() => void refresh()}>
					{t("retryStatus")}
				</button>
			)}
		</div>
	);
}
