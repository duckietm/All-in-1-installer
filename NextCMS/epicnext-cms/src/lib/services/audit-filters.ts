export interface AuditFilters {
	search?: string;
	actor?: string;
	action?: string;
	from?: string;
	to?: string;
	page?: number;
	perPage?: number;
}
function day(value?: string) {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
	const date = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(date.getTime()) &&
		date.toISOString().slice(0, 10) === value
		? value
		: "";
}
export function normalizeAuditFilters(options: AuditFilters = {}) {
	const from = day(options.from);
	const to = day(options.to);
	return {
		search: (options.search ?? "").trim().slice(0, 191),
		actor: (options.actor ?? "").trim().slice(0, 191),
		action: (options.action ?? "").trim().slice(0, 191),
		from,
		to,
		until: to
			? new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000)
					.toISOString()
					.slice(0, 10)
			: "",
		page: Number.isFinite(options.page)
			? Math.min(1000000, Math.max(1, Math.trunc(options.page ?? 1)))
			: 1,
		perPage: Number.isFinite(options.perPage)
			? Math.min(100, Math.max(1, Math.trunc(options.perPage ?? 20)))
			: 20,
	};
}
