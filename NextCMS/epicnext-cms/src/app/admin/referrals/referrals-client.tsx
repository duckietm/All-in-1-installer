"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { updateReferralSettings } from "@/actions/admin-referrals";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";
import { formatDate } from "@/lib/format-date";

export type ReferralRow = {
	id: string;
	inviter: string;
	invitee: string;
	ip: string;
	createdAt: string | null;
};

export function ReferralsClient({
	rows,
	stats,
	canEdit,
	settings,
}: {
	rows: ReferralRow[];
	stats: {
		total: number | null;
		today: number | null;
		claimed: number | null;
		invited: number | null;
	};
	canEdit: boolean;
	settings: {
		needed: string;
		rewardAmount: string;
		rewardCurrency: string;
		blockSameIp: boolean;
	};
}) {
	const t = useTranslations("pages.admin.referrals");
	const { run, isPending } = useServerAction();
	const [needed, setNeeded] = useState(settings.needed);
	const [rewardAmount, setRewardAmount] = useState(settings.rewardAmount);
	const [rewardCurrency, setRewardCurrency] = useState(settings.rewardCurrency);
	const [blockSameIp, setBlockSameIp] = useState(settings.blockSameIp);

	function handleSettings(e: React.FormEvent) {
		e.preventDefault();
		if (!canEdit) return;
		run(
			() =>
				updateReferralSettings({
					referralsNeeded: needed,
					rewardAmount,
					rewardCurrency,
					blockSameIp: blockSameIp ? "1" : "0",
				}),
			{
				successMessage: t("saved"),
				errorMessage: t("saveError"),
			},
		);
	}

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard label={t("referralsToday")} value={stats.today} icon="🎁" />
				<StatusCard label={t("referralsTotal")} value={stats.total} icon="👥" />
				<StatusCard label={t("invitedTotal")} value={stats.invited} icon="🤝" />
				<StatusCard label={t("claims")} value={stats.claimed} icon="💰" />
			</div>

			{canEdit && (
				<section className="mb-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
					<h2 className="mb-4 text-lg font-semibold">{t("settings")}</h2>
					<form onSubmit={handleSettings} className="grid max-w-2xl gap-4">
						<div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
							<label className="grid gap-1 text-sm">
								<span className="text-[var(--color-text-muted)]">
									{t("needed")}
								</span>
								<input
									type="number"
									min="1"
									value={needed}
									onChange={(e) => setNeeded(e.target.value)}
									disabled={isPending}
								/>
							</label>
							<label className="grid gap-1 text-sm">
								<span className="text-[var(--color-text-muted)]">
									{t("rewardAmount")}
								</span>
								<input
									type="number"
									min="1"
									value={rewardAmount}
									onChange={(e) => setRewardAmount(e.target.value)}
									disabled={isPending}
								/>
							</label>
							<label className="grid gap-1 text-sm">
								<span className="text-[var(--color-text-muted)]">
									{t("rewardCurrency")}
								</span>
								<select
									value={rewardCurrency}
									onChange={(e) => setRewardCurrency(e.target.value)}
									disabled={isPending}
								>
									<option value="credits">Credits</option>
									<option value="duckets">Duckets</option>
									<option value="diamonds">Diamonds</option>
									<option value="points">Points</option>
								</select>
							</label>
						</div>
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={blockSameIp}
								onChange={(e) => setBlockSameIp(e.target.checked)}
								disabled={isPending}
							/>
							{t("blockSameIp")}
						</label>
						<div>
							<Button type="submit" disabled={isPending}>
								{isPending ? t("saving") : t("save")}
							</Button>
						</div>
					</form>
				</section>
			)}

			<section>
				<h2 className="mb-4 text-lg font-semibold">{t("recent")}</h2>
				{stats.total === null ? (
					<p role="status" className="text-[var(--color-text-muted)]">
						{t("unavailable")}
					</p>
				) : rows.length === 0 ? (
					<p role="status" className="text-[var(--color-text-muted)]">
						{t("empty")}
					</p>
				) : (
					<div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
						<table className="w-full min-w-[520px] text-left text-sm">
							<thead>
								<tr className="border-b border-[var(--color-border)]">
									<th className="p-3 font-medium">{t("inviter")}</th>
									<th className="p-3 font-medium">{t("invitee")}</th>
									<th className="p-3 font-medium">{t("ip")}</th>
									<th className="p-3 font-medium">{t("date")}</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => (
									<tr
										key={row.id}
										className="border-b border-[var(--color-border)] last:border-0"
									>
										<td className="p-3 font-medium">{row.inviter}</td>
										<td className="p-3">{row.invitee}</td>
										<td className="p-3 text-[var(--color-text-muted)]">
											{row.ip}
										</td>
										<td className="p-3 text-[var(--color-text-muted)]">
											{formatDate(
												row.createdAt ? new Date(row.createdAt) : null,
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</main>
	);
}
