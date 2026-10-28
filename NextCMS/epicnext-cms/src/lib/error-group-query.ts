import type { CmsErrorRecord } from "./error-monitor";
export function queryErrorGroups(
	records: CmsErrorRecord[],
	params: Record<string, string | undefined>,
	now = Date.now(),
) {
	const groups = new Map<string, CmsErrorRecord[]>();
	for (const record of records) {
		const events = groups.get(record.fingerprint) ?? [];
		events.push(record);
		groups.set(record.fingerprint, events);
	}
	const query = (params.q ?? "").trim().slice(0, 200).toLowerCase();
	const duration =
		params.period === "24h"
			? 86400000
			: params.period === "7d"
				? 604800000
				: null;
	return [...groups]
		.flatMap(([fingerprint, events]) => {
			const latest = [...events].sort((a, b) => b.at.localeCompare(a.at))[0];
			if (
				(params.status === "open" && latest.resolved) ||
				(params.status === "resolved" && !latest.resolved)
			)
				return [];
			const matched = events.filter(
				(r) =>
					(!params.release || r.release === params.release) &&
					(!params.source || r.source === params.source) &&
					(!duration ||
						(Date.parse(r.at) >= now - duration && Date.parse(r.at) <= now)) &&
					(!query || JSON.stringify(r).toLowerCase().includes(query)),
			);
			if (!matched.length) return [];
			matched.sort((a, b) => b.at.localeCompare(a.at));
			return [{ fingerprint, events: matched, latest }];
		})
		.sort(
			(a, b) =>
				(params.sort === "frequency" ? b.events.length - a.events.length : 0) ||
				b.events[0].at.localeCompare(a.events[0].at) ||
				a.fingerprint.localeCompare(b.fingerprint),
		);
}
