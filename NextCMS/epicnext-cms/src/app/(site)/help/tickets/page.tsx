import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { createTicket } from "@/actions/help-tickets";
import Link from "@/components/link";
import { ContentCard, EmptyState, StatBlock } from "@/components/public/ui";
import { auth } from "@/lib/auth";
import { db, WebsiteHelpCenterTickets } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

type SearchParams = Promise<{ created?: string; error?: string }>;

function feedbackStyle(tone: "success" | "error"): CSSProperties {
	const accent =
		tone === "error" ? "var(--color-danger)" : "var(--color-primary)";
	return {
		margin: 0,
		padding: "0.85rem 1rem",
		borderRadius: "var(--radius-md)",
		border: `1px solid ${accent}`,
		color: "var(--color-text-readable, var(--color-text))",
		fontSize: "0.9rem",
		fontWeight: 600,
		background: "var(--color-surface)",
		borderLeft: `4px solid ${accent}`,
	};
}

export default async function HelpTicketsPage({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	const t = await getTranslations("pages.helpTickets");
	const { created, error } = await searchParams;

	const userId = Number(session.user.id);

	let tickets: (typeof WebsiteHelpCenterTickets.$inferSelect)[] = [];
	try {
		tickets = await db
			.select()
			.from(WebsiteHelpCenterTickets)
			.where(eq(WebsiteHelpCenterTickets.userId, userId))
			.orderBy(desc(WebsiteHelpCenterTickets.createdAt))
			.limit(100);
	} catch {
		tickets = [];
	}

	const openCount = tickets.filter((t) => t.open).length;
	const closedCount = tickets.length - openCount;

	const errorMessage =
		error === "invalid"
			? t("errors.invalid")
			: error === "moderated"
				? t("errors.moderated")
				: error === "ratelimit"
					? t("errors.ratelimit")
					: error
						? t("errors.error")
						: null;

	return (
		<section className="page-grid">
			{created === "1" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.created")}
				</div>
			) : null}
			{errorMessage ? (
				<div role="alert" style={feedbackStyle("error")}>
					{errorMessage}
				</div>
			) : null}

			<ContentCard icon="🎫" title={t("title")} subtitle={t("subtitle")}>
				<div className="stat-grid">
					<StatBlock icon="🎫" value={tickets.length} label={t("statTotal")} />
					<StatBlock icon="📬" value={openCount} label={t("statOpen")} />
					<StatBlock icon="✅" value={closedCount} label={t("statClosed")} />
				</div>
			</ContentCard>

			<ContentCard icon="✏️" title={t("newTitle")} subtitle={t("newSubtitle")}>
				<form action={createTicket}>
					<div
						style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}
					>
						<input
							name="title"
							placeholder={t("subjectPlaceholder")}
							maxLength={255}
							required
						/>
						<textarea
							name="content"
							placeholder={t("contentPlaceholder")}
							rows={5}
							maxLength={5000}
							required
						/>
						<label
							style={{
								display: "flex",
								alignItems: "center",
								gap: "0.5rem",
								fontSize: "0.9rem",
							}}
						>
							<input type="checkbox" name="banAppeal" value="1" />
							{t("banAppealLabel")}
						</label>
						<div>
							<button type="submit" className="btn btn-primary">
								{t("submit")}
							</button>
						</div>
					</div>
				</form>
			</ContentCard>

			<ContentCard
				icon="📋"
				title={t("listTitle")}
				subtitle={t("listSubtitle")}
				padded={tickets.length === 0}
			>
				{tickets.length === 0 ? (
					<EmptyState icon="🎫">{t("listEmpty")}</EmptyState>
				) : (
					<table>
						<thead>
							<tr>
								<th>{t("colId")}</th>
								<th>{t("colSubject")}</th>
								<th>{t("colStatus")}</th>
								<th>{t("colCreated")}</th>
							</tr>
						</thead>
						<tbody>
							{tickets.map((t2) => (
								<tr key={String(t2.id)}>
									<td>
										<Link href={`/help/tickets/${t2.id}`}>{String(t2.id)}</Link>
									</td>
									<td>
										<Link href={`/help/tickets/${t2.id}`}>{t2.title}</Link>
									</td>
									<td>
										<span className={`online-badge${t2.open ? " online" : ""}`}>
											<span className="online-dot" aria-hidden />
											{t2.open ? t("statusOpen") : t("statusClosed")}
										</span>
									</td>
									<td className="muted">
										{formatDate(t2.createdAt, "datetime", "")}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</ContentCard>
		</section>
	);
}
