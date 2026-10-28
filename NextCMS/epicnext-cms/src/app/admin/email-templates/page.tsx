import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
	createEmailTemplate,
	deleteEmailTemplate,
	updateEmailTemplate,
} from "@/actions/admin-email-templates";
import { Button } from "@/components/ui/button";
import { db, EmailTemplates } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function AdminEmailTemplates() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PAGES_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.emailTemplates");

	let templates: (typeof EmailTemplates.$inferSelect)[] = [];
	try {
		templates = await db
			.select()
			.from(EmailTemplates)
			.orderBy(asc(EmailTemplates.name));
	} catch {
		templates = [];
	}

	return (
		<main>
			<form action={createEmailTemplate} className="admin-card mb-6">
				<h3 className="text-sm font-bold text-[var(--admin-text)] mb-2">
					{t("newTemplate")}
				</h3>
				<div className="flex gap-2 flex-wrap items-center mb-3">
					<input
						name="name"
						placeholder={t("form.namePlaceholder")}
						required
						className="flex-1 min-w-[180px]"
					/>
					<input
						name="subject"
						placeholder={t("form.subjectPlaceholder")}
						required
						className="flex-1 min-w-[220px]"
					/>
					<input
						name="variables"
						placeholder={t("form.variablesPlaceholder")}
						className="min-w-[200px]"
					/>
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							name="isActive"
							defaultChecked
							className="w-auto"
						/>
						<span className="text-sm theme-text-muted dark:theme-text-muted">
							{t("form.active")}
						</span>
					</label>
				</div>
				<textarea
					name="body"
					placeholder={t("form.bodyPlaceholder")}
					required
					rows={5}
					className="w-full resize-y mb-3"
				/>
				<Button type="submit" variant="default">
					{t("create")}
				</Button>
			</form>

			<div className="grid">
				{templates.map((template) => {
					const id = String(template.id);
					return (
						<div key={id} className="admin-card mb-4">
							<form action={updateEmailTemplate}>
								<input type="hidden" name="id" value={id} />
								<div className="flex gap-2 flex-wrap items-center mb-2">
									<strong className="min-w-[160px]">{template.name}</strong>
									<input
										name="subject"
										defaultValue={template.subject}
										placeholder={t("form.subjectPlaceholder")}
										required
										className="flex-1 min-w-[220px]"
									/>
									<input
										name="variables"
										defaultValue={template.variables ?? ""}
										placeholder={t("form.variablesPlaceholder")}
										className="min-w-[180px]"
									/>
									<label className="flex items-center gap-2">
										<input
											type="checkbox"
											name="isActive"
											defaultChecked={template.isActive}
											className="w-auto"
										/>
										<span className="text-sm theme-text-muted dark:theme-text-muted">
											{t("form.active")}
										</span>
									</label>
								</div>
								<textarea
									name="body"
									defaultValue={template.body}
									required
									rows={6}
									className="w-full resize-y mb-2"
								/>
								<div className="flex gap-2 items-center">
									<Button type="submit" variant="default">
										{t("save")}
									</Button>
									{template.updatedAt ? (
										<span className="text-xs theme-text-muted dark:theme-text-muted">
											{t("updated", {
												date: new Date(template.updatedAt)
													.toISOString()
													.slice(0, 16)
													.replace("T", " "),
											})}
										</span>
									) : null}
								</div>
							</form>
							<form action={deleteEmailTemplate} className="mt-4">
								<input type="hidden" name="id" value={id} />
								<Button type="submit" variant="destructive">
									{t("delete")}
								</Button>
							</form>
						</div>
					);
				})}
			</div>
			{templates.length === 0 ? (
				<div className="admin-empty">{t("noTemplates")}</div>
			) : null}
		</main>
	);
}
