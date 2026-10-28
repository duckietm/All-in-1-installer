"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { deleteFavicon, saveFavicon } from "@/actions/save-favicon";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";
import { FaviconGenerator } from "./favicon-generator";

export function FaviconForm({ currentUrl }: { currentUrl: string | null }) {
	const t = useTranslations("pages.admin.favicon");
	const { confirm, dialog: confirmDialog } = useConfirmDialog();
	const [uploading, setUploading] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [preview, setPreview] = useState<string | null>(currentUrl);
	const [message, setMessage] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);
	const formRef = useRef<HTMLFormElement>(null);

	async function handleUpload(formData: FormData) {
		setUploading(true);
		setMessage(null);
		const result = await saveFavicon(formData);
		setUploading(false);

		if (result.success && result.url) {
			setPreview(result.url);
			setMessage({ type: "success", text: t("saved") });
			formRef.current?.reset();
		} else {
			setMessage({ type: "error", text: result.error ?? t("error") });
		}
	}

	async function handleDelete() {
		const ok = await confirm({
			title: t("delete"),
			description: t("confirmDelete"),
			confirmLabel: t("delete"),
			cancelLabel: t("cancel"),
		});
		if (!ok) return;
		setDeleting(true);
		setMessage(null);
		const result = await deleteFavicon();
		setDeleting(false);

		if (result.success) {
			setPreview(null);
			setMessage({ type: "success", text: t("deleted") });
		} else {
			setMessage({ type: "error", text: result.error ?? t("error") });
		}
	}

	async function handleGenerated(blob: Blob) {
		setUploading(true);
		setMessage(null);
		const file = new File([blob], "favicon.png", { type: "image/png" });
		const fd = new FormData();
		fd.append("file", file);
		const result = await saveFavicon(fd);
		setUploading(false);

		if (result.success && result.url) {
			setPreview(result.url);
			setMessage({ type: "success", text: t("saved") });
		} else {
			setMessage({ type: "error", text: result.error ?? t("error") });
		}
	}

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			{confirmDialog}
			<div className="admin-card">
				<h3 className="text-sm font-extrabold text-[var(--admin-text)] mb-4">
					{t("uploadLabel")}
				</h3>
				{preview && (
					<div className="mb-6">
						<label
							htmlFor="favicon-current"
							className="block text-xs font-bold text-[var(--admin-text-muted)] uppercase tracking-wider mb-2"
						>
							{t("current")}
						</label>
						<div className="flex items-center gap-4">
							<Image
								id="favicon-current"
								src={preview}
								alt="Favicon preview"
								width={64}
								height={64}
								className="rounded-lg border-2 border-[var(--admin-border)] object-contain bg-[var(--admin-surface)]"
								unoptimized
							/>
							<div className="text-xs text-[var(--admin-text-muted)] break-all">
								{preview}
							</div>
						</div>
					</div>
				)}

				<form action={handleUpload} ref={formRef}>
					<div className="mb-4">
						<input
							type="file"
							name="file"
							accept=".png,.jpg,.jpeg,.gif,.webp,.ico"
							required
							className="block w-full text-sm text-[var(--color-text-readable)] file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[var(--admin-accent)] file:text-[var(--color-primary-foreground-readable)] cursor-pointer"
						/>
						<p className="mt-1 text-xs text-[var(--admin-text-muted)]">
							{t("uploadHint")}
						</p>
					</div>

					<div className="flex gap-2">
						<Button type="submit" disabled={uploading} variant="default">
							{uploading ? t("uploading") : t("upload")}
						</Button>
						{preview && (
							<Button
								type="button"
								onClick={handleDelete}
								disabled={deleting}
								variant="destructive"
							>
								{deleting ? t("deleting") : t("delete")}
							</Button>
						)}
					</div>
				</form>

				{message && (
					<div
						className={`mt-4 p-3 rounded-lg text-sm ${
							message.type === "success"
								? "bg-[var(--admin-success-subtle)] text-[var(--admin-success)] dark:text-[var(--admin-success)]"
								: "bg-[var(--admin-error-subtle)] text-[var(--admin-error)] dark:text-[var(--admin-error)]"
						}`}
					>
						{message.text}
					</div>
				)}
			</div>

			<FaviconGenerator onSave={handleGenerated} />
		</div>
	);
}
