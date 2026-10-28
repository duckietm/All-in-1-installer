import { z } from "zod";

export const tableViewPath = z
	.string()
	.max(191)
	.regex(/^\/(admin|mod)\/[a-zA-Z0-9/_-]+$/);
export const tableViewState = z.object({
	params: z
		.record(
			z
				.string()
				.regex(
					/^(search|sort|order|perPage|status|assignment|awaiting|filter_[a-zA-Z0-9_]+)$/,
				),
			z.string().max(200),
		)
		.refine((value) => Object.keys(value).length <= 30),
	hidden: z.array(z.string().max(80)).max(60),
});
export const namedTableView = z.object({
	name: z.string().trim().min(1).max(60),
	state: tableViewState,
});
export type NamedTableView = z.infer<typeof namedTableView>;
export function captureTableView(query: string, hidden: string[]) {
	const params: Record<string, string> = {};
	for (const [key, value] of new URLSearchParams(query)) {
		if (
			/^(search|sort|order|perPage|status|assignment|awaiting|filter_[a-zA-Z0-9_]+)$/.test(
				key,
			)
		)
			params[key] = value.slice(0, 200);
	}
	return tableViewState.parse({ params, hidden });
}
