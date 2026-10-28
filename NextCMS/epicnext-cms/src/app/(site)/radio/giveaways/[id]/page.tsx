import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { ContentCard } from "@/components/public/ui";
import { db, RadioGiveaways } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

export default async function RadioGiveawayDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	await getTranslations("pages.radioGiveaways");

	let giveawayId: bigint;
	try {
		giveawayId = BigInt(id);
	} catch {
		notFound();
	}

	const [giveaway] = await db
		.select()
		.from(RadioGiveaways)
		.where(eq(RadioGiveaways.id, giveawayId))
		.limit(1)
		.catch(() => []);

	if (!giveaway) notFound();

	const active = giveaway.isActive ? "Active" : "Ended";
	const prizeStr =
		giveaway.prize ||
		(giveaway.prizeAmount > 0
			? `${giveaway.prizeAmount} ${giveaway.prizeCurrency || "credits"}`
			: null);

	return (
		<section className="page-grid">
			<p className="muted" style={{ margin: 0 }}>
				<Link href="/radio/giveaways">← Back to giveaways</Link>
			</p>

			<ContentCard
				icon="🎁"
				title={giveaway.title || `Giveaway #${giveaway.id}`}
				subtitle={active}
			>
				<table style={{ width: "100%" }}>
					<tbody>
						{giveaway.description ? (
							<tr>
								<th style={{ verticalAlign: "top", width: 120 }}>
									Description
								</th>
								<td>{giveaway.description}</td>
							</tr>
						) : null}
						{prizeStr ? (
							<tr>
								<th>Prize</th>
								<td>{prizeStr}</td>
							</tr>
						) : null}
						<tr>
							<th>Period</th>
							<td>
								{giveaway.startDate
									? formatDate(giveaway.startDate, "datetime-seconds", "")
									: "—"}
								{" — "}
								{giveaway.endDate
									? formatDate(giveaway.endDate, "datetime-seconds", "")
									: "ongoing"}
							</td>
						</tr>
						<tr>
							<th>Created</th>
							<td>
								{formatDate(giveaway.createdAt, "datetime-seconds", "") || (
									<span className="muted">—</span>
								)}
							</td>
						</tr>
						<tr>
							<th>Updated</th>
							<td>
								{formatDate(giveaway.updatedAt, "datetime-seconds", "") || (
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
