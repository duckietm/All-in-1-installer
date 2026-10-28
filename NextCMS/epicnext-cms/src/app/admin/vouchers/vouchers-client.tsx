"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
	createVoucher,
	deleteVoucher,
	updateVoucher,
} from "@/actions/admin-vouchers";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { StatusCard } from "@/components/admin/dashboard";
import { CurrencyIcon } from "@/components/shared/currency-icon";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";
import { formatDate } from "@/lib/format-date";

export type VoucherRow = {
	id: string;
	code: string;
	amount: number;
	maxUses: number;
	useCount: number;
	expiresAt: string | null;
	createdAt: string | null;
	status: "active" | "expired" | "usedUp";
};

export function VouchersClient({
	vouchers,
	canEdit,
	stats,
}: {
	vouchers: VoucherRow[];
	canEdit: boolean;
	stats: { total: number; active: number; usedUp: number; expired: number };
}) {
	const t = useTranslations("pages.admin.vouchers");
	const { run, isPending } = useServerAction();
	const [pendingDelete, setPendingDelete] = useState<VoucherRow | null>(null);
	const [editingVoucher, setEditingVoucher] = useState<VoucherRow | null>(null);
	const [code, setCode] = useState("");
	const [amount, setAmount] = useState("");
	const [maxUses, setMaxUses] = useState("1");
	const [expiresAt, setExpiresAt] = useState("");
	const [editCode, setEditCode] = useState("");
	const [editAmount, setEditAmount] = useState("");
	const [editMaxUses, setEditMaxUses] = useState("1");
	const [editExpiresAt, setEditExpiresAt] = useState("");

	function handleCreate(e: React.FormEvent) {
		e.preventDefault();
		if (!canEdit) return;
		run(
			() =>
				createVoucher({
					code,
					amount: Number(amount),
					maxUses: Number(maxUses),
					expiresAt: expiresAt || undefined,
				}),
			{
				successMessage: t("created"),
				errorMessage: t("createError"),
				onSuccess: () => {
					setCode("");
					setAmount("");
					setMaxUses("1");
					setExpiresAt("");
				},
			},
		);
	}

	function handleConfirmDelete() {
		if (!pendingDelete) return;
		const id = pendingDelete.id;
		run(() => deleteVoucher({ id }), {
			successMessage: t("deleted"),
			errorMessage: t("deleteError"),
			onSuccess: () => setPendingDelete(null),
		});
	}

	function handleStartEdit(v: VoucherRow) {
		setEditingVoucher(v);
		setEditCode(v.code);
		setEditAmount(String(v.amount));
		setEditMaxUses(String(v.maxUses));
		setEditExpiresAt(
			v.expiresAt ? new Date(v.expiresAt).toISOString().slice(0, 16) : "",
		);
	}

	function handleUpdate(e: React.FormEvent) {
		e.preventDefault();
		if (!editingVoucher || !canEdit) return;
		run(
			() =>
				updateVoucher({
					id: editingVoucher.id,
					code: editCode,
					amount: Number(editAmount),
					maxUses: Number(editMaxUses),
					expiresAt: editExpiresAt || undefined,
				}),
			{
				successMessage: t("updated"),
				errorMessage: t("updateError"),
				onSuccess: () => setEditingVoucher(null),
			},
		);
	}

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard label={t("vouchers")} value={stats.total} icon="🎟️" />
				<StatusCard
					label={t("active")}
					value={stats.active}
					state={stats.active > 0 ? "ok" : "neutral"}
					icon="✅"
				/>
				<StatusCard
					label={t("usedUp")}
					value={stats.usedUp}
					state={stats.usedUp > 0 ? "warn" : "neutral"}
					icon="📉"
				/>
				<StatusCard
					label={t("expired")}
					value={stats.expired}
					state={stats.expired > 0 ? "danger" : "neutral"}
					icon="⏰"
				/>
			</div>

			{canEdit && (
				<form onSubmit={handleCreate} className="admin-card mb-6">
					<h3 style={{ marginTop: 0 }}>{t("newVoucher")}</h3>
					<div className="mb-3 grid grid-cols-1 gap-4 md:grid-cols-2">
						<label className="flex flex-col gap-1.5">
							<span className="text-sm theme-text-muted dark:theme-text-muted">
								{t("form.code")}
							</span>
							<input
								value={code}
								onChange={(e) => setCode(e.target.value)}
								placeholder={t("form.codePlaceholder")}
								maxLength={255}
								required
								disabled={isPending}
							/>
						</label>
						<label className="flex flex-col gap-1.5">
							<span className="text-sm theme-text-muted dark:theme-text-muted">
								{t("form.amount")}
							</span>
							<input
								value={amount}
								onChange={(e) => setAmount(e.target.value)}
								type="number"
								min={1}
								placeholder={t("form.amountPlaceholder")}
								required
								disabled={isPending}
							/>
						</label>
						<label className="flex flex-col gap-1.5">
							<span className="text-sm theme-text-muted dark:theme-text-muted">
								{t("form.maxUses")}
							</span>
							<input
								value={maxUses}
								onChange={(e) => setMaxUses(e.target.value)}
								type="number"
								min={1}
								required
								disabled={isPending}
							/>
						</label>
						<label className="flex flex-col gap-1.5">
							<span className="text-sm theme-text-muted dark:theme-text-muted">
								{t("form.expiresAt")}
							</span>
							<input
								value={expiresAt}
								onChange={(e) => setExpiresAt(e.target.value)}
								type="datetime-local"
								disabled={isPending}
							/>
						</label>
					</div>
					<Button type="submit" variant="default" disabled={isPending}>
						{isPending ? t("form.saving") : t("form.create")}
					</Button>
				</form>
			)}

			{canEdit && editingVoucher && (
				<form onSubmit={handleUpdate} className="admin-card mb-6">
					<h3 style={{ marginTop: 0 }}>
						{t("edit")} — {editingVoucher.code}
					</h3>
					<div className="mb-3 grid grid-cols-1 gap-4 md:grid-cols-2">
						<label className="flex flex-col gap-1.5">
							<span className="text-sm theme-text-muted dark:theme-text-muted">
								{t("form.code")}
							</span>
							<input
								value={editCode}
								onChange={(e) => setEditCode(e.target.value)}
								placeholder={t("form.codePlaceholder")}
								maxLength={255}
								required
								disabled={isPending}
							/>
						</label>
						<label className="flex flex-col gap-1.5">
							<span className="text-sm theme-text-muted dark:theme-text-muted">
								{t("form.amount")}
							</span>
							<input
								value={editAmount}
								onChange={(e) => setEditAmount(e.target.value)}
								type="number"
								min={1}
								required
								disabled={isPending}
							/>
						</label>
						<label className="flex flex-col gap-1.5">
							<span className="text-sm theme-text-muted dark:theme-text-muted">
								{t("form.maxUses")}
							</span>
							<input
								value={editMaxUses}
								onChange={(e) => setEditMaxUses(e.target.value)}
								type="number"
								min={1}
								required
								disabled={isPending}
							/>
						</label>
						<label className="flex flex-col gap-1.5">
							<span className="text-sm theme-text-muted dark:theme-text-muted">
								{t("form.expiresAt")}
							</span>
							<input
								value={editExpiresAt}
								onChange={(e) => setEditExpiresAt(e.target.value)}
								type="datetime-local"
								disabled={isPending}
							/>
						</label>
					</div>
					<div className="flex items-center gap-2">
						<Button type="submit" variant="default" disabled={isPending}>
							{isPending ? t("form.saving") : t("form.save")}
						</Button>
						<Button
							type="button"
							variant="ghost"
							disabled={isPending}
							onClick={() => setEditingVoucher(null)}
						>
							{t("form.cancel")}
						</Button>
					</div>
				</form>
			)}

			<section className="mt-6">
				<h2 className="admin-section-title">
					{t("title")} ({vouchers.length})
				</h2>
				<div className="admin-card" style={{ padding: 0, overflowX: "auto" }}>
					{vouchers.length === 0 ? (
						<div className="admin-empty p-4">{t("noVouchers")}</div>
					) : (
						<table>
							<thead>
								<tr>
									<th>{t("colCode")}</th>
									<th>{t("colAmount")}</th>
									<th>{t("colUses")}</th>
									<th>{t("colStatus")}</th>
									<th>{t("colExpires")}</th>
									<th>{t("colCreated")}</th>
									{canEdit && <th>{t("colActions")}</th>}
								</tr>
							</thead>
							<tbody>
								{vouchers.map((v) => (
									<tr key={v.id}>
										<td>
											<code>{v.code}</code>
										</td>
										<td>
											<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
												<CurrencyIcon kind="credits" size={14} />
												{v.amount}
											</span>
										</td>
										<td>
											{v.useCount} / {v.maxUses}
										</td>
										<td>
											{v.status === "expired" ? (
												<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-error-subtle)] text-[var(--admin-text)]">
													{t("statusExpired")}
												</span>
											) : v.status === "usedUp" ? (
												<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-accent)]/18 text-[var(--admin-text)]">
													{t("statusUsedUp")}
												</span>
											) : (
												<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-success-subtle)] text-[var(--admin-text)]">
													{t("statusActive")}
												</span>
											)}
										</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{formatDate(v.expiresAt ? new Date(v.expiresAt) : null)}
										</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{formatDate(v.createdAt ? new Date(v.createdAt) : null)}
										</td>
										{canEdit && (
											<td>
												<div className="flex items-center gap-2">
													<Button
														type="button"
														variant="default"
														disabled={isPending}
														onClick={() => handleStartEdit(v)}
													>
														{t("edit")}
													</Button>
													<Button
														type="button"
														variant="destructive"
														disabled={isPending}
														onClick={() => setPendingDelete(v)}
													>
														{t("delete")}
													</Button>
												</div>
											</td>
										)}
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			</section>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(open) => {
					if (!open) setPendingDelete(null);
				}}
				title={t("confirmDeleteTitle")}
				description={
					pendingDelete ? t("confirmDelete", { code: pendingDelete.code }) : ""
				}
				confirmLabel={t("delete")}
				cancelLabel={t("form.cancel")}
				loading={isPending}
				onConfirm={handleConfirmDelete}
			/>
		</main>
	);
}
