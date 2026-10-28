import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { ContentCard } from "@/components/public/ui";
import { db, RadioContests } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

export default async function RadioContestDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	await getTranslations("pages.radioContests");

	let contestId: bigint;
	try {
		contestId = BigInt(id);
	} catch {
		notFound();
	}

	const [contest] = await db
		.select()
		.from(RadioContests)
		.where(eq(RadioContests.id, contestId))
		.limit(1)
		.catch(() => []);

	if (!contest) notFound();

	const active = contest.isActive ? "Active" : "Ended";

	return (
		<section className="page-grid">
			<p className="muted" style={{ margin: 0 }}>
				<Link href="/radio/contests">← Back to contests</Link>
			</p>

			<ContentCard
				icon="🎉"
				title={contest.title || `Contest #${contest.id}`}
				subtitle={active}
			>
				<table style={{ width: "100%" }}>
					<tbody>
						{contest.description ? (
							<tr>
								<th style={{ verticalAlign: "top", width: 120 }}>
									Description
								</th>
								<td>{contest.description}</td>
							</tr>
						) : null}
						{contest.prize ? (
							<tr>
								<th>Prize</th>
								<td>{contest.prize}</td>
							</tr>
						) : null}
						<tr>
							<th>Period</th>
							<td>
								{contest.startDate
									? formatDate(contest.startDate, "datetime-seconds", "")
									: "—"}
								{" — "}
								{contest.endDate
									? formatDate(contest.endDate, "datetime-seconds", "")
									: "ongoing"}
							</td>
						</tr>
						<tr>
							<th>Created</th>
							<td>
								{formatDate(contest.createdAt, "datetime-seconds", "") || (
									<span className="muted">—</span>
								)}
							</td>
						</tr>
						<tr>
							<th>Updated</th>
							<td>
								{formatDate(contest.updatedAt, "datetime-seconds", "") || (
									<span className="muted">—</span>
								)}
							</td>
						</tr>
					</tbody>
				</table>
			</ContentCard>
		</section>
	);
}
