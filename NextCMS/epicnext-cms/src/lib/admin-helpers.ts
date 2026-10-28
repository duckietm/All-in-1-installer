import type { ListParams } from "@/types/common";

export const PER_PAGE_OPTIONS = [10, 20, 50] as const;
const DEFAULT_PER_PAGE = 20;

export function parseListParams(searchParams: URLSearchParams): ListParams {
	const search = searchParams.get("search") || "";
	const perPage = Math.min(
		Math.max(
			parseInt(searchParams.get("perPage") || String(DEFAULT_PER_PAGE), 10),
			1,
		),
		100,
	);
	const page = Math.max(parseInt(searchParams.get("page") || "1", 10), 1);
	const sort = searchParams.get("sort") || undefined;
	const order = (searchParams.get("order") === "asc" ? "asc" : "desc") as
		| "asc"
		| "desc";

	return { search, perPage, page, sort, order };
}

export function calcPagination(total: number, page: number, perPage: number) {
	const lastPage = Math.max(Math.ceil(total / perPage), 1);
	return {
		total,
		page: Math.min(page, lastPage),
		perPage,
		lastPage,
		offset: (Math.min(page, lastPage) - 1) * perPage,
	};
}
