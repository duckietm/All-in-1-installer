"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-fetch";
export function NitroScale32Generator({
	classname,
	disabled,
	onChanged,
}: {
	classname: string;
	disabled: boolean;
	onChanged: (metadata: Record<string, unknown>) => void;
}) {
	const t = useTranslations("admin.studio.scale32");
	const [preview, setPreview] = useState<{
			hash: string;
			before: string;
			after: string;
			count: number;
			skipped?: number;
		} | null>(null),
		[undo, setUndo] = useState<{ hash: string; backupHash: string } | null>(
			null,
		),
		[busy, setBusy] = useState(false),
		[error, setError] = useState("");
	async function run(action: "preview" | "apply" | "restore") {
		setBusy(true);
		setError("");
		try {
			const response = await adminFetch("/api/admin/studio/nitro-scale32", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					classname,
					action,
					expectedHash: action === "restore" ? undo?.hash : preview?.hash,
					backupHash: undo?.backupHash,
				}),
			});
			const data = await response.json();
			if (!response.ok) throw Error(data.error || t("generationFailed"));
			if (action === "preview") setPreview(data);
			else {
				setPreview(null);
				setUndo(
					action === "apply"
						? { hash: data.hash, backupHash: data.backupHash }
						: null,
				);
				onChanged(data.metadata);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : t("generationFailed"));
		} finally {
			setBusy(false);
		}
	}
	return (
		<section className="space-y-3 rounded-lg border p-3">
			<h3 className="font-semibold">{t("title")}</h3>
			<p className="text-sm text-muted-foreground">{t("intro")}</p>
			{disabled && <p className="text-sm">{t("saveFirst")}</p>}
			<Button
				variant="outline"
				disabled={busy || disabled}
				onClick={() => run("preview")}
			>
				{busy ? t("working") : t("preview")}
			</Button>
			{preview && (
				<>
					<p className="text-sm">
						{t("previewCount", { count: preview.count })}
					</p>
					{preview.skipped ? (
						<p className="text-sm text-destructive" role="alert">
							{t("skipped", { count: preview.skipped })}
						</p>
					) : null}
					<div className="grid grid-cols-2 gap-3">
						{[
							[t("original64"), preview.before],
							[t("derived32"), preview.after],
						].map(([label, src]) => (
							<figure key={label} className="min-w-0">
								<figcaption>{label}</figcaption>
								<div className="overflow-auto p-3">
									<img
										src={src}
										alt={label}
										style={{ imageRendering: "pixelated", maxWidth: "none" }}
									/>
								</div>
							</figure>
						))}
					</div>
					<Button disabled={busy || disabled} onClick={() => run("apply")}>
						{t("saveWithBackup")}
					</Button>
					<Button
						variant="ghost"
						disabled={busy}
						onClick={() => setPreview(null)}
					>
						{t("discard")}
					</Button>
				</>
			)}
			{undo && (
				<div>
					<p className="text-sm">{t("saved")}</p>
					<Button
						variant="outline"
						disabled={busy || disabled}
						onClick={() => run("restore")}
					>
						{t("restore")}
					</Button>
				</div>
			)}
			{error && (
				<p role="alert" className="text-sm">
					{error}
				</p>
			)}
		</section>
	);
}
