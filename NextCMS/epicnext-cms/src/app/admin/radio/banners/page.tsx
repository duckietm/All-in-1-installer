import { asc } from "drizzle-orm";
import NextImage from "next/image";
import { getTranslations } from "next-intl/server";
import {
	createRadioBanner,
	deleteRadioBanner,
	updateRadioBanner,
} from "@/actions/admin-radio-extra";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { db, RadioBanners } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

type Banner = {
	id: bigint;
	userId: bigint;
	imagePath: string;
	title: string | null;
	description: string | null;
	sortOrder: number;
	isActive: boolean;
	createdAt: Date | null;
};

export default async function AdminRadioBannersPage() {
	const t = await getTranslations("pages.admin.radio");

	let banners: Banner[] = [];
	let dbError = false;

	try {
		banners = await db
			.select({
				id: RadioBanners.id,
				userId: RadioBanners.userId,
				imagePath: RadioBanners.imagePath,
				title: RadioBanners.title,
				description: RadioBanners.description,
				sortOrder: RadioBanners.sortOrder,
				isActive: RadioBanners.isActive,
				createdAt: RadioBanners.createdAt,
			})
			.from(RadioBanners)
			.orderBy(asc(RadioBanners.sortOrder), asc(RadioBanners.id));
	} catch {
		dbError = true;
		banners = [];
	}

	const activeCount = banners.filter((b) => b.isActive).length;
	const hiddenCount = banners.length - activeCount;

	return (
		<main>
			{dbError ? (
				<div className="admin-card mb-6">
					<p className="text-xs theme-text-muted dark:theme-text-muted m-0">
						{t("banners.dbError")}
					</p>
				</div>
			) : (
				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
					<StatusCard
						label={t("banners.title")}
						value={banners.length}
						icon="🖼️"
					/>
					<StatusCard
						label={t("banners.statusActive")}
						value={activeCount}
						state={activeCount > 0 ? "ok" : "neutral"}
						icon="✅"
					/>
					<StatusCard
						label={t("banners.statusHidden")}
						value={hiddenCount}
						state={hiddenCount > 0 ? "warn" : "neutral"}
						icon="🚫"
					/>
				</div>
			)}

			<section className="mt-6">
				<h2 className="admin-section-title">{t("banners.addBanner")}</h2>
				<form action={createRadioBanner} className="admin-card">
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<label
								htmlFor="new_imagePath"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("banners.form.imagePath")}
							</label>
							<input
								id="new_imagePath"
								name="imagePath"
								placeholder={t("banners.form.imagePathPlaceholder")}
								required
								style={{ width: "100%" }}
							/>
						</div>
						<div>
							<label
								htmlFor="new_title"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("banners.form.title")}
							</label>
							<input id="new_title" name="title" style={{ width: "100%" }} />
						</div>
						<div style={{ gridColumn: "1 / -1" }}>
							<label
								htmlFor="new_description"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("banners.form.description")}
							</label>
							<textarea
								id="new_description"
								name="description"
								rows={2}
								style={{ width: "100%" }}
							/>
						</div>
						<div>
							<label
								htmlFor="new_sortOrder"
								style={{ display: "block", fontWeight: 700 }}
							>
								{t("banners.form.sortOrder")}
							</label>
							<input
								id="new_sortOrder"
								name="sortOrder"
								type="number"
								defaultValue={0}
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
								{t("banners.form.active")}
							</label>
						</div>
					</div>
					<div style={{ marginTop: "0.75rem" }}>
						<Button type="submit" variant="default">
							{t("banners.createBanner")}
						</Button>
					</div>
				</form>
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">
					{t("banners.existing", { count: banners.length })}
				</h2>
				{banners.length === 0 ? (
					<div className="admin-empty">{t("banners.noBanners")}</div>
				) : (
					<div className="grid">
						{banners.map((b) => (
							<div key={String(b.id)} className="admin-card">
								<div className="flex justify-between items-baseline gap-3">
									<strong>#{String(b.id)}</strong>
									<span className="text-sm theme-text-muted dark:theme-text-muted inline-flex gap-2 items-center">
										{t("banners.byUser", { id: String(b.userId) })} ·{" "}
										{formatDate(b.createdAt, "datetime", "\u2014")} ·{" "}
										<span
											className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${b.isActive ? "bg-[var(--admin-success-subtle)] text-[var(--admin-text)]" : "bg-[var(--admin-error-subtle)] text-[var(--admin-text)]"}`}
										>
											{b.isActive ? t("banners.active") : t("banners.hidden")}
										</span>
									</span>
								</div>

								{b.imagePath ? (
									<NextImage
										src={b.imagePath}
										alt={b.title ?? t("banners.bannerAlt")}
										width={800}
										height={200}
										className="article-img my-2"
										unoptimized
									/>
								) : null}

								<form action={updateRadioBanner}>
									<input type="hidden" name="id" value={String(b.id)} />
									<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
										<div>
											<label
												htmlFor={`img_${b.id}`}
												style={{ display: "block", fontWeight: 700 }}
											>
												{t("banners.form.imagePath")}
											</label>
											<input
												id={`img_${b.id}`}
												name="imagePath"
												defaultValue={b.imagePath}
												required
												style={{ width: "100%" }}
											/>
										</div>
										<div>
											<label
												htmlFor={`title_${b.id}`}
												style={{ display: "block", fontWeight: 700 }}
											>
												{t("banners.form.title")}
											</label>
											<input
												id={`title_${b.id}`}
												name="title"
												defaultValue={b.title ?? ""}
												style={{ width: "100%" }}
											/>
										</div>
										<div style={{ gridColumn: "1 / -1" }}>
											<label
												htmlFor={`desc_${b.id}`}
												style={{ display: "block", fontWeight: 700 }}
											>
												{t("banners.form.description")}
											</label>
											<textarea
												id={`desc_${b.id}`}
												name="description"
												rows={2}
												defaultValue={b.description ?? ""}
												style={{ width: "100%" }}
											/>
										</div>
										<div>
											<label
												htmlFor={`sort_${b.id}`}
												style={{ display: "block", fontWeight: 700 }}
											>
												{t("banners.form.sortOrder")}
											</label>
											<input
												id={`sort_${b.id}`}
												name="sortOrder"
												type="number"
												defaultValue={b.sortOrder}
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
													defaultChecked={b.isActive}
												/>{" "}
												{t("banners.form.active")}
											</label>
										</div>
									</div>
									<div style={{ marginTop: "0.6rem" }}>
										<Button type="submit" variant="default">
											{t("banners.save")}
										</Button>
									</div>
								</form>

								<form
									action={deleteRadioBanner}
									style={{ marginTop: "0.5rem" }}
								>
									<input type="hidden" name="id" value={String(b.id)} />
									<Button type="submit" variant="destructive">
										{t("banners.delete")}
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
