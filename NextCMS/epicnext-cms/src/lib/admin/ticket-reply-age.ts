export function ticketReplyAge(
	value: Date | string | null,
	now = Date.now(),
): number | null {
	if (!value) return null;
	const time = value instanceof Date ? value.getTime() : Date.parse(value);
	return Number.isFinite(time)
		? Math.max(0, Math.floor((now - time) / 60000))
		: null;
}
