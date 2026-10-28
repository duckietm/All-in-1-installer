import { asc, eq, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { db, RadioSchedules, User } from "@/lib/db";

// Weekly order so the table reads Monday → Sunday regardless of insert order.
// The `day` column stores a free-form string; we key case-insensitively.
const DAYS = [
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
] as const;

// `start_time` / `end_time` are MySQL TIME columns; the driver hydrates them as a
// Date on the 1970-01-01 epoch. Pull just HH:MM in UTC (Time has no zone).
function formatTime(d: Date | null | undefined): string {
	if (!d) return "";
	return d.toISOString().slice(11, 16);
}

type Slot = {
	id: string;
	dj: string;
	showName: string | null;
	description: string | null;
	start: string;
	end: string;
};

export default async function RadioSchedulePage() {
	const t = await getTranslations("pages.radioSchedule");

	const schedules = await db
		.select()
		.from(RadioSchedules)
		.where(eq(RadioSchedules.isActive, true))
		.orderBy(asc(RadioSchedules.startTime))
		.catch(() => []);

	// Resolve DJ usernames. schedule.userId is BigInt; User.id is Int — convert.
	const djIds = Array.from(new Set(schedules.map((s) => Number(s.userId))));
	const djs = djIds.length
		? await db
				.select({ id: User.id, username: User.username })
				.from(User)
				.where(inArray(User.id, djIds))
				.catch(() => [])
		: [];
	const djById = new Map(djs.map((u) => [u.id, u.username]));

	// Bucket slots by normalised day name.
	const byDay = new Map<string, Slot[]>();
	for (const day of DAYS) byDay.set(day, []);
	for (const s of schedules) {
		const key =
			DAYS.find((d) => d.toLowerCase() === s.day.trim().toLowerCase()) ?? s.day;
		const slot: Slot = {
			id: String(s.id),
			dj: djById.get(Number(s.userId)) ?? `User #${s.userId}`,
			showName: s.showName,
			description: s.description,
			start: formatTime(s.startTime),
			end: formatTime(s.endTime),
		};
		const bucket = byDay.get(key);
		if (bucket) bucket.push(slot);
		else byDay.set(key, [slot]);
	}

	const hasAny = schedules.length > 0;

	return (
		<section className="page-grid">
			<ContentCard icon="🗓️" title={t("title")} subtitle={t("subtitle")} />

			<ContentCard padded={!hasAny}>
				{!hasAny ? (
					<EmptyState icon="🗓️">{t("empty")}</EmptyState>
				) : (
					<table>
						<thead>
							<tr>
								<th>{t("colDay")}</th>
								<th>{t("colTime")}</th>
								<th>{t("colDj")}</th>
								<th>{t("colShow")}</th>
							</tr>
						</thead>
						<tbody>
							{DAYS.map((day) => {
								const slots = byDay.get(day) ?? [];
								if (slots.length === 0) {
									return (
										<tr key={day}>
											<td>
												<strong>{day}</strong>
											</td>
											<td colSpan={3} className="muted">
												{t("noShows")}
											</td>
										</tr>
									);
								}
								return slots.map((slot, i) => (
									<tr key={slot.id}>
										<td>{i === 0 ? <strong>{day}</strong> : ""}</td>
										<td>
											{slot.start}
											{slot.end ? ` – ${slot.end}` : ""}
										</td>
										<td>{slot.dj}</td>
										<td>
											{slot.showName || <span className="muted">—</span>}
											{slot.description ? (
												<div className="muted">{slot.description}</div>
											) : null}
										</td>
									</tr>
								));
							})}
						</tbody>
					</table>
				)}
			</ContentCard>
		</section>
	);
}
