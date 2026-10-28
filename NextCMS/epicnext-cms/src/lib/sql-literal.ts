/**
 * A string as a SQL literal for statements that are built as text (generated repair SQL,
 * CASE lists): hex-encoded, so no quote, backslash or SQL mode can break out of it.
 * Prefer drizzle's `sql` parameters wherever a statement is not stored or shown as text.
 */
export function sqlStringLiteral(value: string): string {
	if (value === "") return "''";
	return `CONVERT(X'${Buffer.from(value, "utf8").toString("hex")}' USING utf8mb4)`;
}
