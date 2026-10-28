import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
	createBox,
	deleteBox,
	toggleBox,
	updateBox,
} from "@/actions/admin-writeable-boxes";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { db, WebsiteWriteableBoxes } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export const metadata = { title: "Writeable boxes" };

export default async function AdminWriteableBoxes() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PAGES_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.writeableBoxes");
	const boxes = await db
		.select()
		.from(WebsiteWriteableBoxes)
		.orderBy(asc(WebsiteWriteableBoxes.position), asc(WebsiteWriteableBoxes.id))
		.limit(500)
		.catch(() => []);

	const activeCount = boxes.filter((b) => b.isActive).length;

	return (
		<main>
			<section className="mt-6">
				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
					<StatusCard label={t("totalBoxes")} value={boxes.length} icon="🗂️" />
					<StatusCard
						label={t("active")}
						value={activeCount}
						state={activeCount > 0 ? "ok" : "neutral"}
						hint={t("shownOnHomePage")}
						icon="✅"
					/>
				</div>
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("newBox")}</h2>
				<form
					action={createBox}
					className="grid grid-cols-1 gap-4 md:grid-cols-2"
				>
					<div>
						<label
							htmlFor="new_title"
							style={{ display: "block", fontWeight: 700 }}
						>
							{t("form.name")}
						</label>
						<input
							id="new_title"
							name="title"
							required
							maxLength={255}
							style={{ width: "100%" }}
						/>
					</div>
					<div>
						<label
							htmlFor="new_icon"
							style={{ display: "block", fontWeight: 700 }}
						>
							{t("form.iconEmoji")}
						</label>
						<input
							id="new_icon"
							name="icon"
							maxLength={255}
							placeholder="📰"
							style={{ width: "100%" }}
						/>
					</div>
					<div>
						<label
							htmlFor="new_position"
							style={{ display: "block", fontWeight: 700 }}
						>
							{t("position")}
						</label>
						<input
							id="new_position"
							name="position"
							type="number"
							min={0}
							defaultValue={boxes.length}
							style={{ width: "100%" }}
						/>
					</div>
					<div style={{ display: "flex", alignItems: "flex-end" }}>
						<label
							style={{
								display: "flex",
								alignItems: "center",
								gap: "0.4rem",
								fontWeight: 700,
							}}
						>
							<input type="checkbox" name="isActive" value="1" defaultChecked />{" "}
							{t("active")}
						</label>
					</div>
					<div style={{ gridColumn: "1 / -1" }}>
						<label
							htmlFor="new_content"
							style={{ display: "block", fontWeight: 700 }}
						>
							{t("form.content")}
						</label>
						<textarea
							id="new_content"
							name="content"
							rows={5}
							style={{ width: "100%", fontFamily: "monospace" }}
						/>
					</div>
					<div
						style={{
							gridColumn: "1 / -1",
							display: "flex",
							justifyContent: "flex-end",
						}}
					>
						<Button type="submit" variant="default">
							{t("form.save")}
						</Button>
					</div>
				</form>
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">
					{t("boxes")} ({boxes.length})
				</h2>
				{boxes.length === 0 ? (
					<div className="admin-empty">{t("noBoxes")}</div>
				) : (
					<div
						style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}
					>
						{boxes.map((box) => (
							<div key={String(box.id)} className="admin-card">
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "0.6rem",
										marginBottom: "0.75rem",
									}}
								>
									<span className="text-sm theme-text-muted dark:theme-text-muted">
										#{String(box.id)}
									</span>
									{box.icon ? <span aria-hidden>{box.icon}</span> : null}
									<strong className="flex-1">{box.title}</strong>
									<span
										className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${box.isActive ? "bg-[var(--admin-success-subtle)] text-[var(--admin-text)]" : "bg-[var(--admin-error-subtle)] text-[var(--admin-text)]"}`}
									>
										{box.isActive ? t("active") : t("hidden")}
									</span>
								</div>

								<form
									action={updateBox}
									className="grid grid-cols-1 gap-4 md:grid-cols-2"
								>
									<input type="hidden" name="id" value={String(box.id)} />
									<div>
										<label
											htmlFor={`title_${box.id}`}
											style={{ display: "block", fontWeight: 700 }}
										>
											{t("form.name")}
										</label>
										<input
											id={`title_${box.id}`}
											name="title"
											required
											maxLength={255}
											defaultValue={box.title}
											style={{ width: "100%" }}
										/>
									</div>
									<div>
										<label
											htmlFor={`icon_${box.id}`}
											style={{ display: "block", fontWeight: 700 }}
										>
											{t("form.iconEmoji")}
										</label>
										<input
											id={`icon_${box.id}`}
											name="icon"
											maxLength={255}
											defaultValue={box.icon ?? ""}
											style={{ width: "100%" }}
										/>
									</div>
									<div>
										<label
											htmlFor={`position_${box.id}`}
											style={{ display: "block", fontWeight: 700 }}
										>
											{t("position")}
										</label>
										<input
											id={`position_${box.id}`}
											name="position"
											type="number"
											min={0}
											defaultValue={box.position}
											style={{ width: "100%" }}
										/>
									</div>
									<div style={{ display: "flex", alignItems: "flex-end" }}>
										<label
											style={{
												display: "flex",
												alignItems: "center",
												gap: "0.4rem",
												fontWeight: 700,
											}}
										>
											<input
												type="checkbox"
												name="isActive"
												value="1"
												defaultChecked={box.isActive}
											/>{" "}
											{t("active")}
										</label>
									</div>
									<div style={{ gridColumn: "1 / -1" }}>
										<label
											htmlFor={`content_${box.id}`}
											style={{ display: "block", fontWeight: 700 }}
										>
											{t("form.content")}
										</label>
										<textarea
											id={`content_${box.id}`}
											name="content"
											rows={5}
											defaultValue={box.content}
											style={{ width: "100%", fontFamily: "monospace" }}
										/>
									</div>
									<div
										style={{
											gridColumn: "1 / -1",
											display: "flex",
											justifyContent: "flex-end",
										}}
									>
										<Button type="submit" variant="default">
											{t("form.save")}
										</Button>
									</div>
								</form>

								<div
									style={{
										display: "flex",
										gap: "0.5rem",
										marginTop: "0.75rem",
										paddingTop: "0.75rem",
										borderTop: "1px solid rgba(255,255,255,0.08)",
									}}
								>
									<form action={toggleBox}>
										<input type="hidden" name="id" value={String(box.id)} />
										<input
											type="hidden"
											name="next"
											value={box.isActive ? "0" : "1"}
										/>
										<Button type="submit" variant="outline">
											{box.isActive ? t("hide") : t("activate")}
										</Button>
									</form>
									<form action={deleteBox}>
										<input type="hidden" name="id" value={String(box.id)} />
										<Button type="submit" variant="destructive">
											{t("delete")}
										</Button>
									</form>
								</div>
							</div>
						))}
					</div>
				)}
			</section>
		</main>
	);
}
