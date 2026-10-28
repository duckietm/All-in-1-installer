import { redirect } from "next/navigation";
import { calcPagination, parseListParams } from "./admin-helpers";
import { canAccess, getAdminContext, type PermissionSet } from "./permissions";

interface AdminListConfig<TRow> {
	/** Permission slug required to view this page */
	permission: string;
	/** Default items per page. Default: 20 */
	defaultPerPage?: number;
	/**
	 * Runs the actual data query (Drizzle). Receives parsed list params and
	 * returns the rows + total count for the current page.
	 */
	fetch: (args: {
		search: string;
		page: number;
		perPage: number;
		rawParams: Record<string, string>;
	}) => Promise<{ rows: TRow[]; total: number }>;
}

interface AdminListResult<TRow> {
	rows: TRow[];
	total: number;
	page: number;
	perPage: number;
	lastPage: number;
	locale: string;
	permissions: PermissionSet;
	rank: number;
}

/**
 * Generic admin list data fetcher.
 * Centralizes the common pattern: auth check, param parsing, pagination and
 * row mapping. The caller supplies a Drizzle query via `config.fetch`.
 */
export async function fetchAdminList<TRow>(
	config: AdminListConfig<TRow>,
	paramsPromise: Promise<{ locale: string }>,
	searchParamsPromise: Promise<Record<string, string>>,
): Promise<AdminListResult<TRow>> {
	const { locale } = await paramsPromise;
	const { session, permissions } = await getAdminContext();

	if (!canAccess(permissions, config.permission, session.user.rank)) {
		redirect("/admin");
	}

	const rawParams = await searchParamsPromise;
	const sp = new URLSearchParams(rawParams);
	const parsed = parseListParams(sp);
	// `parsed.perPage` is already clamped to 1..100; re-reading the raw value
	// here let `?perPage=100000` pass straight into LIMIT.
	const perPage = config.defaultPerPage
		? parsed.perPage || config.defaultPerPage
		: parsed.perPage;

	const { rows, total } = await config.fetch({
		search: parsed.search,
		page: parsed.page,
		perPage,
		rawParams,
	});

	const pagination = calcPagination(total, parsed.page, perPage);

	return {
		rows,
		...pagination,
		locale,
		permissions,
		rank: session.user.rank,
	};
}
