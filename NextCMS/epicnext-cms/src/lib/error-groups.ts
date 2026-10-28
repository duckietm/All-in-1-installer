import { isDeliveryReference } from "@/features/operations/delivery-diagnostics";
import type { CmsErrorRecord } from "./error-monitor";

export function errorOperationLink(record: CmsErrorRecord): string | null {
	const context = record.context;
	if (record.source === "server") {
		if (
			context.module === "operations" &&
			isDeliveryReference(context.deliveryId)
		)
			return `/admin/devops/deliveries?id=${context.deliveryId}`;
		if (context.module === "news") {
			const id = String(context.articleId ?? "");
			return /^[1-9]\d{0,18}$/.test(id)
				? `/admin/articles/${id}`
				: "/admin/articles";
		}
		const routes: Record<string, string> = {
			catalog: "/admin/catalog",
			media: "/admin/media",
			users: "/admin/users",
			settings: "/admin/settings",
			studio: "/admin/studio",
		};
		if (
			typeof context.module === "string" &&
			Object.hasOwn(routes, context.module)
		)
			return routes[context.module];
	}
	// Never use arbitrary error-provided URLs as navigation targets.
	const candidate = context.path;
	if (typeof candidate !== "string") return null;
	if (
		/^\/admin\/(articles|users|catalog|media|settings|studio)$/.test(candidate)
	)
		return candidate;
	if (/^\/admin\/articles\/[1-9]\d{0,18}$/.test(candidate)) return candidate;
	return null;
}
export function summarizeErrorGroup(events: CmsErrorRecord[]) {
	const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
	const first = sorted[0];
	const latest = sorted.at(-1);
	const users = new Set<string>();
	let unidentified = 0;
	const releases = new Map<
		string,
		{ release: string; count: number; firstAt: string; lastAt: string }
	>();
	for (const event of sorted) {
		const raw = event.source === "server" ? event.context.userId : null;
		const id =
			typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0
				? String(raw)
				: typeof raw === "string" && /^[1-9]\d{0,14}$/.test(raw)
					? raw
					: null;
		if (id) users.add(id);
		else unidentified++;
		const prior = releases.get(event.release);
		releases.set(event.release, {
			release: event.release,
			count: (prior?.count ?? 0) + 1,
			firstAt: prior?.firstAt ?? event.at,
			lastAt: event.at,
		});
	}
	return {
		count: events.length,
		firstAt: first?.at ?? null,
		lastAt: latest?.at ?? null,
		affectedUsers: users.size,
		unidentified,
		releases: [...releases.values()],
		latest,
		operationLink: latest ? errorOperationLink(latest) : null,
		auditLink:
			latest?.source === "server" &&
			typeof latest.context.operationId === "string" &&
			/^[a-zA-Z0-9-]{1,100}$/.test(latest.context.operationId)
				? `/admin/logs/audit?search=${encodeURIComponent(latest.context.operationId)}`
				: null,
	};
}
