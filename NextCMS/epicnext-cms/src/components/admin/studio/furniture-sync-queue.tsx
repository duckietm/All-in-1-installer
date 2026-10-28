"use client";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { refreshCatalogTree } from "@/features/catalog/client/use-live-catalog";
import { adminFetch } from "@/lib/admin-fetch";
import { FurnitureJobHistory } from "./furniture-jobs";
import { useFurnitureJobs } from "./use-furniture-jobs";

export function FurnitureSyncQueue({ kind }: { kind: "official" | "clone" }) {
	const t = useTranslations("pages.admin.syncQueue");
	// A sync job writes offers and pages server-side; the history list alone
	// would leave the catalog rail and stats bar showing pre-sync numbers.
	const history = useFurnitureJobs(() => void refreshCatalogTree(), true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [queued, setQueued] = useState(false);
	const requestId = useRef<string | null>(null);
	const submitting = useRef(false);
	async function start() {
		if (submitting.current) return;
		submitting.current = true;
		setBusy(true);
		setError("");
		setQueued(false);
		// Keep the ID after an uncertain response, including a browser reload.
		const key = `furniture-sync-request:${kind}`;
		try {
			if (!requestId.current) {
				try {
					requestId.current = sessionStorage.getItem(key);
				} catch {}
				requestId.current ||= crypto.randomUUID();
			}
			try {
				sessionStorage.setItem(key, requestId.current);
			} catch {}
			const response = await adminFetch(`/api/admin/import/${kind}/sync-all`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: requestId.current }),
			});
			const result = await response.json().catch(() => ({}));
			if (response.status >= 400 && response.status < 500) {
				requestId.current = null;
				try {
					sessionStorage.removeItem(key);
				} catch {}
			}
			if (!response.ok) throw Error(result.error || t("failed"));
			if (result.job?.id !== requestId.current) throw Error(t("failed"));
			try {
				sessionStorage.removeItem(key);
			} catch {}
			requestId.current = null;
			setQueued(true);
			await history.refresh();
		} catch (error) {
			setError(error instanceof Error ? error.message : t("failed"));
		} finally {
			submitting.current = false;
			setBusy(false);
		}
	}
	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">{t("description")}</p>
			<Button disabled={busy} onClick={() => void start()}>
				{busy ? t("preparing") : t("start")}
			</Button>
			{error && <p role="alert">{error}</p>}
			{queued && <p role="status">{t("queued")}</p>}
			<FurnitureJobHistory state={history} expanded />
		</div>
	);
}
