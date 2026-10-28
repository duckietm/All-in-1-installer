import { asc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import {
	createRadioRank,
	deleteRadioRank,
	updateRadioRank,
} from "@/actions/admin-radio-extra";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { db, RadioRanks } from "@/lib/db";

type Rank = {
	id: bigint;
	name: string;
	description: string | null;
	badgeCode: string | null;
	isActive: boolean;
};

export default async function AdminRadioRanksPage() {
	const t = await getTranslations("pages.admin.radio");

	let ranks: Rank[] = [];
	let dbError = false;

	try {
		ranks = await db
			.select({
				id: RadioRanks.id,
				name: RadioRanks.name,
				description: RadioRanks.description,
				badgeCode: RadioRanks.badgeCode,
				isActive: RadioRanks.isActive,
			})
			.from(RadioRanks)
			.orderBy(asc(RadioRanks.id));
	} catch {
		dbError = true;
		ranks = [];
	}

	const activeCount = ranks.filter((r) => r.isActive).length;

	return (
		<main>
			{dbError ? (
				<div className="admin-card mb-6">
					<p className="text-xs theme-text-muted dark:theme-text-muted m-0">
						{t("ranksForm.dbError")}
					</p>
				</div>
			) : (
				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
					<StatusCard label={t("ranks")} value={ranks.length} icon="🎖️" />
					<StatusCard
						label={t("ranksForm.active")}
						value={activeCount}
						state={activeCount > 0 ? "ok" : "neutral"}
						icon="✅"
					/>
				</div>
			)}

			<section className="mt-6">
				<h2 className="admin-section-title">{t("ranksForm.addRank")}</h2>
				<form action={createRadioRank} className="admin-card">
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div>
							<label
								htmlFor="new_name"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("ranksForm.name")}
							</label>
							<input
								id="new_name"
								name="name"
								required
								style={{ width: "100%" }}
							/>
						</div>
						<div>
							<label
								htmlFor="new_badge"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("ranksForm.badgeCode")}
							</label>
							<input
								id="new_badge"
								name="badgeCode"
								style={{ width: "100%" }}
							/>
						</div>
						<div style={{ display: "flex", alignItems: "flex-end" }}>
							<label
								style={{
									display: "inline-flex",
									gap: "0.4rem",
									alignItems: "center",
								}}
							>
								<input
									type="checkbox"
									name="isActive"
									value="1"
									defaultChecked
								/>{" "}
								{t("ranksForm.active")}
							</label>
						</div>
						<div style={{ gridColumn: "1 / -1" }}>
							<label
								htmlFor="new_desc"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("ranksForm.description")}
							</label>
							<input
								id="new_desc"
								name="description"
								style={{ width: "100%" }}
							/>
						</div>
					</div>
					<div style={{ marginTop: "0.75rem" }}>
						<Button type="submit" variant="default">
							{t("ranksForm.createRank")}
						</Button>
					</div>
				</form>
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">
					{t("ranksForm.existing", { count: ranks.length })}
				</h2>
				{ranks.length === 0 ? (
					<div className="admin-empty">{t("ranksForm.noRanks")}</div>
				) : (
					<div className="grid">
						{ranks.map((r) => (
							<div key={String(r.id)} className="admin-card">
								<div className="flex justify-between items-baseline gap-3 mb-2">
									<strong>#{String(r.id)}</strong>
									<span
										className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${r.isActive ? "bg-[var(--admin-success-subtle)] text-[var(--admin-text)]" : "bg-[var(--admin-error-subtle)] text-[var(--admin-text)]"}`}
									>
										{r.isActive
											? t("ranksForm.activeLabel")
											: t("ranksForm.inactiveLabel")}
									</span>
								</div>

								<form
									action={updateRadioRank}
									className="flex items-center gap-2 flex-wrap"
								>
									<input type="hidden" name="id" value={String(r.id)} />
									<input
										name="name"
										defaultValue={r.name}
										required
										placeholder={t("ranksForm.name")}
										style={{ minWidth: 140 }}
									/>
									<input
										name="badgeCode"
										defaultValue={r.badgeCode ?? ""}
										placeholder={t("ranksForm.badgeCode")}
										style={{ minWidth: 100 }}
									/>
									<input
										name="description"
										defaultValue={r.description ?? ""}
										placeholder={t("ranksForm.description")}
										className="flex-1 min-w-[160px]"
									/>
									<label
										style={{
											display: "inline-flex",
											gap: "0.3rem",
											alignItems: "center",
										}}
									>
										<input
											type="checkbox"
											name="isActive"
											value="1"
											defaultChecked={r.isActive}
										/>{" "}
										{t("ranksForm.active")}
									</label>
									<Button type="submit" variant="default">
										{t("ranksForm.save")}
									</Button>
								</form>

								<form action={deleteRadioRank} style={{ marginTop: "0.5rem" }}>
									<input type="hidden" name="id" value={String(r.id)} />
									<Button type="submit" variant="destructive">
										{t("ranksForm.deleteRank", { id: String(r.id) })}
									</Button>
								</form>
							</div>
						))}
					</div>
				)}
			</section>
		</main>
	);
}
