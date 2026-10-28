"use client";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-fetch";
export function ImportAttachmentRecovery({
	jobId,
	classname,
	disabled,
	onResumed,
}: {
	jobId: string;
	classname: string;
	disabled: boolean;
	onResumed: () => Promise<unknown>;
}) {
	const t = useTranslations("admin.studio.importDiagnostics");
	const lock = useRef(false);
	const [busy, setBusy] = useState(false);
	const [attachmentId, setAttachmentId] = useState("");
	const [error, setError] = useState("");
	async function attach(file: File) {
		if (disabled || lock.current) return;
		lock.current = true;
		setBusy(true);
		setError("");
		setAttachmentId("");
		try {
			const form = new FormData();
			form.set("classname", classname);
			form.set("file", file);
			const response = await adminFetch("/api/admin/studio/import-attachment", {
				method: "POST",
				body: form,
			});
			const data = await response.json();
			if (!response.ok || typeof data.attachmentId !== "string") {
				setError(
					t(data.code === "mismatchedFile" ? "mismatchedFile" : "invalidFile"),
				);
				return;
			}
			setAttachmentId(data.attachmentId);
		} catch {
			setError(t("network"));
		} finally {
			lock.current = false;
			setBusy(false);
		}
	}
	async function resume() {
		if (disabled || lock.current || !attachmentId) return;
		lock.current = true;
		setBusy(true);
		setError("");
		try {
			const response = await adminFetch("/api/admin/studio/import-jobs", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id: jobId,
					action: "retry",
					attachments: { [classname]: attachmentId },
				}),
			});
			if (!response.ok) {
				const data = await response.json();
				const code =
					data.code === "alreadyStarted"
						? "alreadyStarted"
						: data.code === "notEligible"
							? "notEligible"
							: data.code === "invalidFile"
								? "invalidFile"
								: "resumeError";
				setError(t(code));
				return;
			}
			setAttachmentId("");
			await onResumed();
		} catch {
			setError(t("network"));
		} finally {
			lock.current = false;
			setBusy(false);
		}
	}
	return (
		<details className="my-2 rounded border border-[var(--admin-border)] p-2">
			<summary className="cursor-pointer">{t("recover")}</summary>
			<p className="my-2 text-xs text-[var(--admin-text-muted)]">
				{t("recoveryHint", { file: `${classname.split("*")[0]}.hab` })}
			</p>
			<label className="block text-xs">
				{t("attach")}
				<input
					type="file"
					accept=".hab,.nitro"
					className="my-2 block max-w-full"
					disabled={disabled || busy}
					onChange={(event) => {
						const file = event.target.files?.[0];
						if (file) void attach(file);
						event.target.value = "";
					}}
				/>
			</label>
			{busy && <p role="status">{t("working")}</p>}
			{attachmentId && (
				<>
					<p role="status">{t("attached")}</p>
					<Button
						variant="outline"
						disabled={disabled || busy}
						onClick={() => void resume()}
					>
						{t("resume")}
					</Button>
				</>
			)}
			{error && (
				<p role="alert" className="text-[var(--admin-warning)]">
					{error}
				</p>
			)}
		</details>
	);
}
