const MYSQL2_UNSUPPORTED_OPTIONS = [
	"connection_limit",
	"pool_timeout",
	"connect_timeout",
] as const;

export function mysqlConnectionUrl(value: string): string {
	const url = new URL(value);
	for (const option of MYSQL2_UNSUPPORTED_OPTIONS)
		url.searchParams.delete(option);
	return url.toString();
}
