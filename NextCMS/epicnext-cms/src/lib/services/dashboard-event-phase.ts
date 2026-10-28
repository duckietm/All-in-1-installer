export function getDashboardEventPhase(
	event: { status: string; startsAt: Date; endsAt: Date | null },
	now: Date,
): "upcoming" | "ongoing" | null {
	if (event.status !== "published") return null;
	if (event.startsAt > now) return "upcoming";
	return event.endsAt && event.endsAt > now ? "ongoing" : null;
}
