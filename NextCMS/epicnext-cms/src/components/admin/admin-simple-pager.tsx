import Link from "@/components/link";

/** Minimal prev/next pager for admin list pages without DataTable. */
export function AdminSimplePager({
	page,
	lastPage,
	total,
	basePath,
	params,
	label,
}: {
	page: number;
	lastPage: number;
	total: number;
	basePath: string;
	/** Extra query params preserved across pages (e.g. filter=sold). */
	params?: Record<string, string>;
	label?: string;
}) {
	if (lastPage <= 1) return null;

	const href = (p: number) => {
		const u = new URLSearchParams(params);
		u.set("page", String(p));
		return `${basePath}?${u.toString()}`;
	};

	return (
		<div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--admin-text-muted)]">
			<span>
				{label ? `${label} · ` : null}
				{total} total · page {page}/{lastPage}
			</span>
			<div className="flex items-center gap-2">
				{page > 1 ? (
					<Link className="btn btn-ghost btn-sm" href={href(page - 1)}>
						Previous
					</Link>
				) : (
					<span className="opacity-40">Previous</span>
				)}
				{page < lastPage ? (
					<Link className="btn btn-ghost btn-sm" href={href(page + 1)}>
						Next
					</Link>
				) : (
					<span className="opacity-40">Next</span>
				)}
			</div>
		</div>
	);
}
