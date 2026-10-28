import { desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { signOutEverywhere } from "@/actions/sessions";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { auth } from "@/lib/auth";
import { db, queryRows, WebsiteLoginLogs } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

type SearchParams = Promise<{ signedOutAll?: string }>;

/** Tiny user-agent → "Browser on OS" summary (no dependency). */
function deviceLabel(ua: string | null, unknown: string): string {
	if (!ua) return unknown;
	const browser = /Edg/.test(ua)
		? "Edge"
		: /OPR|Opera/.test(ua)
			? "Opera"
			: /Chrome/.test(ua)
				? "Chrome"
				: /Firefox/.test(ua)
					? "Firefox"
					: /Safari/.test(ua)
						? "Safari"
						: "Browser";
	const os = /Windows/.test(ua)
		? "Windows"
		: /Android/.test(ua)
			? "Android"
			: /iPhone|iPad|iOS/.test(ua)
				? "iOS"
				: /Mac OS X|Macintosh/.test(ua)
					? "macOS"
					: /Linux/.test(ua)
						? "Linux"
						: "";
	return os ? `${browser} on ${os}` : browser;
}

export async function generateMetadata() {
	const t = await getTranslations("pages.sessions");
	return { title: t("title") };
}

export default async function SessionsPage({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	const t = await getTranslations("pages.sessions");
	const session = await auth();
	if (!session?.user?.id) redirect("/login");
	const userId = Number(session.user.id);
	const { signedOutAll } = await searchParams;

	const logins = await db
		.select({
			id: WebsiteLoginLogs.id,
			ip: WebsiteLoginLogs.ip,
			userAgent: WebsiteLoginLogs.userAgent,
			createdAt: WebsiteLoginLogs.createdAt,
		})
		.from(WebsiteLoginLogs)
		.where(eq(WebsiteLoginLogs.userId, userId))
		.orderBy(desc(WebsiteLoginLogs.id))
		.limit(30)
		.catch(() => []);

	type Failed = { id: number; ip_address: string; attempted_at: Date | string };
	let failed: Failed[] = [];
	try {
		failed = await queryRows<Failed>(sql`
			SELECT id, ip_address, attempted_at FROM failed_logins
			WHERE username = ${session.user.name} ORDER BY id DESC LIMIT 15
		`);
	} catch {
		failed = [];
	}

	return (
		<section className="page-grid">
			{signedOutAll === "1" ? (
				<p
					role="status"
					style={{
						margin: 0,
						padding: "0.85rem 1rem",
						borderRadius: "var(--radius-md)",
						border: "1px solid var(--color-primary)",
						borderLeft: "4px solid var(--color-primary)",
					}}
				>
					{t("successSignedOutAll")}
				</p>
			) : null}

			<ContentCard icon="🔐" title={t("title")} subtitle={t("subtitle")} />

			<ContentCard
				icon="🚪"
				title={t("signOutEverywhereTitle")}
				subtitle={t("signOutEverywhereDescription")}
			>
				<form action={signOutEverywhere} style={{ padding: "1rem" }}>
					<button type="submit" className="btn btn-danger">
						{t("signOutEverywhereButton")}
					</button>
				</form>
			</ContentCard>

			<ContentCard
				icon="✅"
				title={t("recentTitle")}
				padded={logins.length === 0}
			>
				{logins.length === 0 ? (
					<EmptyState icon="🔐">{t("recentEmpty")}</EmptyState>
				) : (
					<table>
						<thead>
							<tr>
								<th>{t("colWhen")}</th>
								<th>{t("colIp")}</th>
								<th>{t("colDevice")}</th>
							</tr>
						</thead>
						<tbody>
							{logins.map((l) => (
								<tr key={String(l.id)}>
									<td className="muted" style={{ whiteSpace: "nowrap" }}>
										{formatDate(l.createdAt)}
									</td>
									<td className="muted">{l.ip}</td>
									<td>{deviceLabel(l.userAgent, t("unknownDevice"))}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</ContentCard>

			{failed.length > 0 ? (
				<ContentCard
					icon="⚠️"
					title={t("failedTitle")}
					subtitle={t("failedSubtitle")}
				>
					<table>
						<thead>
							<tr>
								<th>{t("colWhen")}</th>
								<th>{t("colIp")}</th>
							</tr>
						</thead>
						<tbody>
							{failed.map((f) => (
								<tr key={f.id}>
									<td className="muted" style={{ whiteSpace: "nowrap" }}>
										{formatDate(
											typeof f.attempted_at === "string"
												? new Date(f.attempted_at)
												: f.attempted_at,
										)}
									</td>
									<td className="muted">{f.ip_address}</td>
								</tr>
							))}
						</tbody>
					</table>
				</ContentCard>
			) : null}
		</section>
	);
}
