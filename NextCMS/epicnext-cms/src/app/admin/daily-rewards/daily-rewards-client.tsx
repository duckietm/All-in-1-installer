"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
	deleteDailyReward,
	setDailyRewardEnabled,
	upsertDailyReward,
} from "@/actions/admin-daily-rewards";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { StatusCard } from "@/components/admin/dashboard";
import {
	CurrencyIcon,
	type CurrencyKind,
} from "@/components/shared/currency-icon";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";

const CURRENCIES = ["credits", "duckets", "diamonds", "points"] as const;

function asCurrencyKind(value: string): CurrencyKind {
	return (CURRENCIES as readonly string[]).includes(value)
		? (value as CurrencyKind)
		: "duckets";
}

export type DailyRewardEditRow = {
	id: string;
	day: number;
	currency: string;
	amount: number;
};

export function DailyRewardsClient({
	rows,
	enabled,
	canEdit,
	claimsToday,
	dayTotal,
}: {
	rows: DailyRewardEditRow[];
	enabled: boolean;
	canEdit: boolean;
	claimsToday: number | null;
	dayTotal: number | null;
}) {
	const t = useTranslations("pages.admin.dailyRewards");
	const { run, isPending } = useServerAction();
	const [editingRow, setEditingRow] = useState<DailyRewardEditRow | null>(null);
	const [pendingDelete, setPendingDelete] = useState<DailyRewardEditRow | null>(
		null,
	);
	// "Add day" draft row (id-less until saved).
	const [draft, setDraft] = useState({
		day: String(rows.reduce((max, r) => Math.max(max, r.day), 0) + 1),
		currency: "duckets",
		amount: "50",
	});
	const [editDraft, setEditDraft] = useState({ currency: "", amount: "" });

	function handleSave() {
		if (!canEdit) return;
		run(
			() =>
				upsertDailyReward({
					day: draft.day,
					currency: draft.currency,
					amount: draft.amount,
				}),
			{
				successMessage: t("created"),
				errorMessage: t("saveError"),
			},
		);
	}

	function handleToggle() {
		if (!canEdit) return;
		run(() => setDailyRewardEnabled({ enabled: !enabled }), {
			successMessage: t("saved"),
			errorMessage: t("saveError"),
		});
	}

	function handleStartEdit(row: DailyRewardEditRow) {
		setEditingRow(row);
		setEditDraft({ currency: row.currency, amount: String(row.amount) });
	}

	function handleConfirmUpdate() {
		if (!editingRow || !canEdit) return;
		run(
			() =>
				upsertDailyReward({
					id: editingRow.id,
					day: String(editingRow.day),
					currency: editDraft.currency,
					amount: editDraft.amount,
				}),
			{
				successMessage: t("updated"),
				errorMessage: t("saveError"),
				onSuccess: () => setEditingRow(null),
			},
		);
	}

	function handleConfirmDelete() {
		if (!pendingDelete) return;
		const id = pendingDelete.id;
		run(() => deleteDailyReward({ id }), {
			successMessage: t("deleted"),
			errorMessage: t("deleteError"),
			onSuccess: () => setPendingDelete(null),
		});
	}

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard
					label={t("enabled")}
					value={enabled ? t("yes") : t("no")}
					icon="📅"
				/>
				<StatusCard label={t("scheduleDays")} value={rows.length} icon="🗓️" />
				<StatusCard label={t("claimsToday")} value={claimsToday} icon="🎁" />
				<StatusCard label={t("claimsTotal")} value={dayTotal} icon="💰" />
			</div>

			{canEdit && (
				<section className="mb-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
					<div className="flex flex-wrap items-center justify-between gap-4">
						<h2 className="text-lg font-semibold">{t("status")}</h2>
						<Button
							type="button"
							variant={enabled ? "destructive" : "default"}
							onClick={handleToggle}
							disabled={isPending}
						>
							{t(enabled ? "disable" : "enable")}
						</Button>
					</div>
					<p className="mt-2 text-sm text-[var(--color-text-muted)]">
						{t("statusHint")}
					</p>
				</section>
			)}

			<section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
				<h2 className="mb-4 text-lg font-semibold">{t("schedule")}</h2>

				<div className="overflow-x-auto">
					<table className="w-full min-w-[480px] text-left text-sm">
						<thead>
							<tr className="border-b border-[var(--color-border)]">
								<th className="p-3 font-medium">{t("day")}</th>
								<th className="p-3 font-medium">{t("reward")}</th>
								<th className="p-3 font-medium">{t("actions")}</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((row) => (
								<tr
									key={row.id}
									className="border-b border-[var(--color-border)] last:border-0"
								>
									<td className="p-3 font-medium">
										{t("day", { day: row.day })}
									</td>
									<td className="p-3">
										{editingRow?.id === row.id ? (
											<div className="flex flex-wrap gap-2">
												<select
													value={editDraft.currency}
													onChange={(e) =>
														setEditDraft((d) => ({
															...d,
															currency: e.target.value,
														}))
													}
												>
													{CURRENCIES.map((c) => (
														<option key={c} value={c}>
															{c}
														</option>
													))}
												</select>
												<input
													type="number"
													min="1"
													value={editDraft.amount}
													onChange={(e) =>
														setEditDraft((d) => ({
															...d,
															amount: e.target.value,
														}))
													}
												/>
											</div>
										) : (
											<span className="inline-flex items-center gap-2">
												<CurrencyIcon
													kind={asCurrencyKind(row.currency)}
													size={18}
													alt=""
												/>
												{row.amount} {row.currency}
											</span>
										)}
									</td>
									<td className="p-3">
										{editingRow?.id === row.id ? (
											<div className="flex gap-2">
												<Button
													type="button"
													onClick={handleConfirmUpdate}
													disabled={isPending}
												>
													{t("save")}
												</Button>
												<Button
													type="button"
													variant="ghost"
													onClick={() => setEditingRow(null)}
												>
													{t("cancel")}
												</Button>
											</div>
										) : (
											<div className="flex gap-2">
												<Button
													type="button"
													variant="outline"
													onClick={() => handleStartEdit(row)}
												>
													{t("edit")}
												</Button>
												<Button
													type="button"
													variant="destructive"
													onClick={() => setPendingDelete(row)}
												>
													{t("delete")}
												</Button>
											</div>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				{canEdit && (
					<div className="mt-5 grid max-w-2xl grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3 rounded-lg border border-[var(--color-border)] p-4">
						<label className="grid gap-1 text-sm">
							<span className="text-[var(--color-text-muted)]">
								{t("addDay")}
							</span>
							<input
								type="number"
								min="1"
								max="365"
								value={draft.day}
								onChange={(e) =>
									setDraft((d) => ({ ...d, day: e.target.value }))
								}
							/>
						</label>
						<label className="grid gap-1 text-sm">
							<span className="text-[var(--color-text-muted)]">
								{t("reward")}
							</span>
							<select
								value={draft.currency}
								onChange={(e) =>
									setDraft((d) => ({ ...d, currency: e.target.value }))
								}
							>
								{CURRENCIES.map((c) => (
									<option key={c} value={c}>
										{c}
									</option>
								))}
							</select>
						</label>
						<label className="grid gap-1 text-sm">
							<span className="text-[var(--color-text-muted)]">
								{t("amount")}
							</span>
							<input
								type="number"
								min="1"
								value={draft.amount}
								onChange={(e) =>
									setDraft((d) => ({ ...d, amount: e.target.value }))
								}
							/>
						</label>
						<div className="flex items-end">
							<Button type="button" onClick={handleSave} disabled={isPending}>
								{t("add")}
							</Button>
						</div>
					</div>
				)}
			</section>

			{canEdit && (
				<ConfirmDialog
					open={pendingDelete !== null}
					onOpenChange={(open) => {
						if (!open) setPendingDelete(null);
					}}
					title={t("confirmDeleteTitle")}
					description={t("confirmDeleteBody")}
					confirmLabel={t("delete")}
					cancelLabel={t("cancel")}
					loading={isPending}
					onConfirm={handleConfirmDelete}
				/>
			)}
		</main>
	);
}
