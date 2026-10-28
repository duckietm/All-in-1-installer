export function userListHref(query: string): string {
	const search = new URLSearchParams(query).toString();
	return search ? `/admin/users?${search}` : "/admin/users";
}
export function userDetailHref(
	id: number,
	mode: "show" | "edit",
	query: string,
): string {
	return `/admin/users/${mode}/${id}?list=${encodeURIComponent(query)}`;
}
