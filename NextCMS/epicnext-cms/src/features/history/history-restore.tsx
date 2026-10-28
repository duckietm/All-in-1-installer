"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { previewHistoryRestore, restoreHistory } from "@/actions/history";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
export function HistoryRestore({ id }: { id: number }) {
	const t = useTranslations("pages.admin.logs.history");
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const pending = useRef<"preview" | "restore" | null>(null);
	const [busy, setBusy] = useState<"preview" | "restore" | null>(null);
	const [error, setError] = useState("");
	const [preview, setPreview] = useState<Awaited<
		ReturnType<typeof previewHistoryRestore>
	> | null>(null);
	async function load() {
		if (pending.current) return;
		pending.current = "preview";
		setOpen(true);
		setBusy("preview");
		setError("");
		setPreview(null);
		try {
			setPreview(await previewHistoryRestore(id));
		} catch {
			setError(t("unavailable"));
		} finally {
			pending.current = null;
			setBusy(null);
		}
	}
	async function restore() {
		if (pending.current || !preview?.canRestore || !preview.changes.length)
			return;
		pending.current = "restore";
		setBusy("restore");
		setError("");
		try {
			const result = await restoreHistory(id);
			if (!result.ok) {
				setError(t(result.code));
				setPreview(null);
				return;
			}
			setOpen(false);
			router.refresh();
		} catch {
			setError(t("failed"));
		} finally {
			pending.current = null;
			setBusy(null);
		}
	}
	return (
		<>
			<Button
				size="sm"
				variant="outline"
				onClick={load}
				disabled={busy !== null}
			>
				{t("preview")}
			</Button>
			<Dialog
				open={open}
				onOpenChange={(nextOpen, details) => {
					if (!nextOpen && pending.current === "restore") {
						details.cancel();
						return;
					}
					setOpen(nextOpen);
				}}
			>
				<DialogContent
					className="w-[calc(100%-2rem)] min-w-0 overflow-x-hidden sm:max-w-3xl"
					showCloseButton={busy !== "restore"}
				>
					<DialogTitle className="pr-6 leading-snug">{t("title")}</DialogTitle>
					<DialogDescription>{t("description")}</DialogDescription>
					{busy && (
						<p role="status">
							{t(busy === "restore" ? "restoring" : "loading")}
						</p>
					)}
					{error && (
						<p role="alert" className="text-destructive">
							{error}
						</p>
					)}
					{preview && (
						<>
							{!preview.canRestore && (
								<p role="alert" className="text-destructive">
									{t("conflict")}
								</p>
							)}

							<div className="max-h-[50dvh] min-w-0 space-y-4 overflow-y-auto pr-1">
								{preview.changes.map((change) => (
									<section
										key={change.key}
										className="min-w-0 rounded-lg border p-3"
									>
										<h3 className="mb-2 text-sm font-semibold">
											{t.has(`fields.${change.key}`)
												? t(`fields.${change.key}`)
												: t("field")}
										</h3>
										<dl className="grid min-w-0 gap-3 sm:grid-cols-2">
											<div className="min-w-0">
												<dt className="mb-1 text-xs text-muted-foreground">
													{t("current")}
												</dt>
												<dd className="min-w-0">
													<pre className="max-h-52 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md bg-muted/40 p-2 text-xs">
														{String(change.current ?? "—")}
													</pre>
												</dd>
											</div>
											<div className="min-w-0">
												<dt className="mb-1 text-xs text-muted-foreground">
													{t("restore")}
												</dt>
												<dd className="min-w-0">
													<pre className="max-h-52 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md bg-muted/40 p-2 text-xs">
														{String(change.restore ?? "—")}
													</pre>
												</dd>
											</div>
										</dl>
									</section>
								))}
							</div>

							<Button
								disabled={
									busy !== null ||
									!preview.canRestore ||
									!preview.changes.length
								}
								onClick={restore}
							>
								{t("confirm")}
							</Button>
						</>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
