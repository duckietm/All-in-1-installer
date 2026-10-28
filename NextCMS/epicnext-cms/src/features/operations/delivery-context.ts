/** Public presentation data only: never forward a stored operation payload to the browser. */
export function deliveryContext(
	kind: string,
	serialized: string | null,
	access: { news: boolean; catalog: boolean },
): { title: string | null; href: string | null; changedCount: number | null } {
	const context = {
		title: null as string | null,
		href: null as string | null,
		changedCount: null as number | null,
	};
	let result: Record<string, unknown> = {};
	if (serialized && serialized.length <= 1_048_576) {
		try {
			const parsed: unknown = JSON.parse(serialized);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
				result = parsed as Record<string, unknown>;
		} catch {
			/* Older records may not contain presentation metadata. */
		}
	}
	if (
		["news.create", "news.update", "news.schedule.publish"].includes(kind) &&
		access.news
	) {
		context.href = "/admin/articles";
		if (typeof result.articleTitle === "string" && result.articleTitle.trim()) {
			context.title = result.articleTitle.trim().slice(0, 255);
			context.href = `/admin/articles?${new URLSearchParams({ search: context.title.slice(0, 191) })}`;
		}
		if (
			typeof result.articleId === "string" &&
			/^[1-9][0-9]{0,19}$/.test(result.articleId)
		)
			context.href = `/admin/articles/${result.articleId}`;
	} else if (
		["catalog.bulk.apply", "catalog.bulk.undo"].includes(kind) &&
		access.catalog
	) {
		context.href = "/admin/catalog";
		if (
			typeof result.changedCount === "number" &&
			Number.isSafeInteger(result.changedCount) &&
			result.changedCount >= 0 &&
			result.changedCount <= 500
		)
			context.changedCount = result.changedCount;
	}
	return context;
}
export function deliveryTopic(topic: string) {
	if (topic === "catalog.refresh") return "hotel";
	if (topic === "catalog.export.request") return "export";
	if (topic === "news.refresh") return "news";
	return "unknown";
}
