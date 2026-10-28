"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { addWord, deleteWord } from "@/actions/admin-wordfilter";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";

export type WordFilterRow = { id: string; word: string };

export function WordFilterClient({
	words,
	canEdit,
}: {
	words: WordFilterRow[];
	canEdit: boolean;
}) {
	const t = useTranslations("pages.admin.wordfilter");
	const { run, isPending } = useServerAction();
	const [word, setWord] = useState("");
	const [pendingDelete, setPendingDelete] = useState<WordFilterRow | null>(
		null,
	);

	function handleAdd(e: React.FormEvent) {
		e.preventDefault();
		const trimmed = word.trim();
		if (!trimmed || !canEdit) return;
		run(() => addWord({ word: trimmed }), {
			successMessage: t("added"),
			errorMessage: t("addError"),
			onSuccess: () => setWord(""),
		});
	}

	function handleConfirmDelete() {
		if (!pendingDelete) return;
		const id = pendingDelete.id;
		run(() => deleteWord({ id }), {
			successMessage: t("deleted"),
			errorMessage: t("deleteError"),
			onSuccess: () => setPendingDelete(null),
		});
	}

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard label={t("filteredWords")} value={words.length} icon="🚫" />
			</div>

			{canEdit && (
				<section className="mt-6">
					<h2 className="admin-section-title">{t("addWord")}</h2>
					<form onSubmit={handleAdd} className="admin-card">
						<div className="flex gap-2 flex-wrap">
							<input
								value={word}
								onChange={(e) => setWord(e.target.value)}
								placeholder={t("form.wordPlaceholder")}
								required
								maxLength={255}
								disabled={isPending}
								className="flex-1 min-w-[200px]"
							/>
							<Button
								type="submit"
								disabled={isPending || !word.trim()}
								variant="default"
							>
								{isPending ? t("form.saving") : t("form.save")}
							</Button>
						</div>
					</form>
				</section>
			)}

			<section className="mt-6">
				<h2 className="admin-section-title">
					{t("words")}{" "}
					<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-accent)]/18 text-[var(--admin-text)]">
						{words.length}
					</span>
				</h2>
				{words.length === 0 ? (
					<div className="admin-empty">{t("noWords")}</div>
				) : (
					<div className="admin-card" style={{ padding: 0, overflowX: "auto" }}>
						<table>
							<thead>
								<tr>
									<th>{t("colId")}</th>
									<th>{t("colWord")}</th>
									{canEdit && <th>{t("colActions")}</th>}
								</tr>
							</thead>
							<tbody>
								{words.map((w) => (
									<tr key={w.id}>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{w.id}
										</td>
										<td>
											<strong>{w.word}</strong>
										</td>
										{canEdit && (
											<td>
												<Button
													type="button"
													variant="destructive"
													disabled={isPending}
													onClick={() => setPendingDelete(w)}
												>
													{t("delete")}
												</Button>
											</td>
										)}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(open) => {
					if (!open) setPendingDelete(null);
				}}
				title={t("confirmDeleteTitle")}
				description={
					pendingDelete ? t("confirmDelete", { word: pendingDelete.word }) : ""
				}
				confirmLabel={t("delete")}
				cancelLabel={t("form.cancel")}
				loading={isPending}
				onConfirm={handleConfirmDelete}
			/>
		</main>
	);
}
