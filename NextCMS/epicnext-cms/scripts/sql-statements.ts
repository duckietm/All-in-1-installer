export function splitSqlStatements(sql: string): string[] {
	const withoutComments = sql
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*--.*$/gm, "");

	return withoutComments
		.split(";")
		.map((statement) => statement.trim())
		.filter(Boolean);
}
