import { desc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { deleteShout } from "@/actions/admin-radio-moderation";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { db, RadioShouts } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

type Shout = {
	id: bigint;
	userId: bigint;
	message: string;
	createdAt: Date | null;
	updatedAt: Date | null;
};

export default async function AdminRadioModerationPage() {
	const t = await getTranslations("pages.admin.radio");

	let shouts: Shout[] = [];
	try {
		shouts = await db
			.select({
				id: RadioShouts.id,
				userId: RadioShouts.userId,
				message: RadioShouts.message,
				createdAt: RadioShouts.createdAt,
				updatedAt: RadioShouts.updatedAt,
			})
			.from(RadioShouts)
			.orderBy(desc(RadioShouts.id))
			.limit(50);
	} catch {
		shouts = [];
	}

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard label={t("shouts")} value={shouts.length} icon="📣" />
			</div>

			<section className="mt-6">
				<h2 className="admin-section-title">
					{t("moderationPage.recentShouts", { count: shouts.length })}
				</h2>
				{shouts.length === 0 ? (
					<div className="admin-empty">{t("noShouts")}</div>
				) : (
					<table>
						<thead>
							<tr>
								<th>ID</th>
								<th>{t("user")}</th>
								<th>{t("message")}</th>
								<th>{t("posted")}</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{shouts.map((s) => (
								<tr key={String(s.id)}>
									<td>{String(s.id)}</td>
									<td>{String(s.userId)}</td>
									<td>{s.message}</td>
									<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
										{formatDate(s.createdAt, "datetime", "\u2014")}
									</td>
									<td>
										<form action={deleteShout}>
											<input type="hidden" name="id" value={String(s.id)} />
											<Button type="submit" variant="destructive">
												{t("deleteShout")}
											</Button>
										</form>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</section>
		</main>
	);
}
