import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
	createCategory,
	createValue,
	deleteCategory,
	deleteValue,
	updateCategory,
	updateValue,
} from "@/actions/admin-rare-values";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { db, WebsiteRareValueCategories, WebsiteRareValues } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

const CURRENCY_TYPES = ["diamonds", "credits", "duckets", "points"];

export default async function AdminRareValues() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SHOP_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.rareValues");

	let categories: (typeof WebsiteRareValueCategories.$inferSelect)[] = [];
	try {
		categories = await db
			.select()
			.from(WebsiteRareValueCategories)
			.orderBy(
				asc(WebsiteRareValueCategories.priority),
				asc(WebsiteRareValueCategories.name),
			);
	} catch {
		categories = [];
	}

	let values: (typeof WebsiteRareValues.$inferSelect)[] = [];
	try {
		values = await db
			.select()
			.from(WebsiteRareValues)
			.orderBy(asc(WebsiteRareValues.name));
	} catch {
		values = [];
	}

	const valuesByCategory = new Map<string, typeof values>();
	for (const v of values) {
		const key = String(v.categoryId);
		const list = valuesByCategory.get(key);
		if (list) list.push(v);
		else valuesByCategory.set(key, [v]);
	}

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard
					label={t("categories")}
					value={categories.length}
					icon="🗂️"
				/>
				<StatusCard label={t("items")} value={values.length} icon="💎" />
			</div>

			<form action={createCategory} className="admin-card mb-6">
				<h3 className="text-sm font-bold text-[var(--admin-text)] m-0 mb-3">
					{t("addCategory")}
				</h3>
				<div className="flex gap-2 flex-wrap">
					<input
						name="name"
						placeholder={t("categoryForm.namePlaceholder")}
						required
						className="flex-1 min-w-[160px]"
					/>
					<input name="badge" placeholder={t("badgePlaceholder")} required />
					<input
						name="priority"
						type="number"
						min={1}
						defaultValue={1}
						placeholder={t("priorityPlaceholder")}
						className="w-[110px]"
					/>
					<Button type="submit" variant="default">
						{t("addCategoryButton")}
					</Button>
				</div>
			</form>

			{categories.length === 0 ? (
				<div className="admin-empty">{t("noCategories")}</div>
			) : null}

			<div className="grid">
				{categories.map((cat) => {
					const catId = String(cat.id);
					const rows = valuesByCategory.get(catId) ?? [];
					return (
						<div key={catId} className="admin-card">
							<div className="flex gap-3 items-baseline justify-between flex-wrap">
								<div
									style={{
										display: "flex",
										gap: "0.6rem",
										alignItems: "baseline",
										flexWrap: "wrap",
									}}
								>
									<strong>{cat.name}</strong>
									<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-accent)]/18 text-[var(--admin-text)]">
										{t("badgeLabel", { badge: cat.badge })}
									</span>
									<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-accent)]/18 text-[var(--admin-text)]">
										{t("priorityLabel", { priority: cat.priority })}
									</span>
									<span className="text-sm theme-text-muted dark:theme-text-muted">
										{t("itemCount", { count: rows.length })}
									</span>
								</div>
								<div className="flex gap-2 items-center">
									<details className="group">
										<summary className="cursor-pointer list-none text-xs font-bold text-[var(--admin-accent)] hover:underline">
											{t("editCategory")}
										</summary>
										<form
											action={updateCategory}
											className="mt-2 flex gap-2 flex-wrap"
										>
											<input type="hidden" name="id" value={catId} />
											<input
												name="name"
												defaultValue={cat.name}
												placeholder={t("categoryForm.namePlaceholder")}
												required
												className="flex-1 min-w-[140px]"
											/>
											<input
												name="badge"
												defaultValue={cat.badge}
												placeholder={t("badgePlaceholder")}
												required
											/>
											<input
												name="priority"
												type="number"
												min={1}
												defaultValue={cat.priority}
												placeholder={t("priorityPlaceholder")}
												className="w-[110px]"
											/>
											<Button type="submit" variant="default">
												{t("categoryForm.save")}
											</Button>
										</form>
									</details>
									<form action={deleteCategory}>
										<input type="hidden" name="id" value={catId} />
										<Button type="submit" variant="destructive">
											{t("deleteCategory")}
										</Button>
									</form>
								</div>
							</div>

							<table style={{ marginTop: "0.75rem" }}>
								<thead>
									<tr>
										<th>{t("colItemName")}</th>
										<th>{t("colItemId")}</th>
										<th>{t("colCredits")}</th>
										<th>{t("colCurrencyValue")}</th>
										<th>{t("colCurrency")}</th>
										<th>{t("colIcon")}</th>
										<th />
									</tr>
								</thead>
								<tbody>
									{rows.map((v) => {
										const vId = String(v.id);
										return (
											<tr key={vId}>
												<td>{v.name}</td>
												<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
													{v.itemId ?? "—"}
												</td>
												<td>{v.creditValue ?? "—"}</td>
												<td>{v.currencyValue ?? "—"}</td>
												<td>
													<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-accent)]/18 text-[var(--admin-text)]">
														{v.currencyType}
													</span>
												</td>
												<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
													{v.furnitureIcon}
												</td>
												<td>
													<div className="flex gap-1 items-center">
														<details className="group">
															<summary className="cursor-pointer list-none text-[0.72rem] font-bold text-[var(--admin-accent)] hover:underline">
																{t("editValue")}
															</summary>
															<form
																action={updateValue}
																className="mt-2 flex gap-1 flex-wrap items-end"
															>
																<input type="hidden" name="id" value={vId} />
																<input
																	type="hidden"
																	name="categoryId"
																	value={catId}
																/>
																<input
																	name="name"
																	defaultValue={v.name}
																	placeholder={t(
																		"itemForm.itemNamePlaceholder",
																	)}
																	required
																	className="min-w-[120px]"
																/>
																<input
																	name="itemId"
																	type="number"
																	min={1}
																	defaultValue={v.itemId ?? ""}
																	placeholder={t("itemForm.itemIdPlaceholder")}
																	className="w-[90px]"
																/>
																<input
																	name="furnitureIcon"
																	defaultValue={v.furnitureIcon}
																	placeholder={t("itemForm.iconPlaceholder")}
																	required
																	className="min-w-[120px]"
																/>
																<input
																	name="creditValue"
																	defaultValue={v.creditValue ?? ""}
																	placeholder={t("itemForm.creditsPlaceholder")}
																	className="w-[110px]"
																/>
																<input
																	name="currencyValue"
																	defaultValue={v.currencyValue ?? ""}
																	placeholder={t(
																		"itemForm.currencyValuePlaceholder",
																	)}
																	className="w-[110px]"
																/>
																<select
																	name="currencyType"
																	defaultValue={v.currencyType}
																>
																	{CURRENCY_TYPES.map((c) => (
																		<option key={c} value={c}>
																			{c}
																		</option>
																	))}
																</select>
																<Button
																	type="submit"
																	variant="default"
																	className="text-xs"
																>
																	{t("itemForm.save")}
																</Button>
															</form>
														</details>
														<form action={deleteValue}>
															<input type="hidden" name="id" value={vId} />
															<Button type="submit" variant="destructive">
																✕
															</Button>
														</form>
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
							{rows.length === 0 ? (
								<p
									className="text-xs theme-text-muted dark:theme-text-muted"
									style={{ margin: "0.5rem 0 0" }}
								>
									{t("noValuesInCategory")}
								</p>
							) : null}

							<form action={createValue} style={{ marginTop: "0.75rem" }}>
								<input type="hidden" name="categoryId" value={catId} />
								<div className="flex gap-2 flex-wrap">
									<input
										name="name"
										placeholder={t("itemForm.itemNamePlaceholder")}
										required
										className="flex-1 min-w-[140px]"
									/>
									<input
										name="itemId"
										type="number"
										min={1}
										placeholder={t("itemForm.itemIdPlaceholder")}
										className="w-[110px]"
									/>
									<input
										name="furnitureIcon"
										placeholder={t("itemForm.iconPlaceholder")}
										required
										className="min-w-[140px]"
									/>
									<input
										name="creditValue"
										placeholder={t("itemForm.creditsPlaceholder")}
										className="w-[130px]"
									/>
									<input
										name="currencyValue"
										placeholder={t("itemForm.currencyValuePlaceholder")}
										className="w-[130px]"
									/>
									<select name="currencyType" defaultValue="diamonds">
										{CURRENCY_TYPES.map((c) => (
											<option key={c} value={c}>
												{c}
											</option>
										))}
									</select>
									<Button type="submit" variant="default">
										{t("itemForm.addValue")}
									</Button>
								</div>
							</form>
						</div>
					);
				})}
			</div>
		</main>
	);
}
