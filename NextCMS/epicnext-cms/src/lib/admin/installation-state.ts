export type DiagnosticState = "ok" | "failed" | "unknown" | "missing";
export function workerState(
	value: string | null,
	now = Date.now(),
): DiagnosticState {
	if (!value) return "unknown";
	const time = Date.parse(value);
	if (!Number.isFinite(time) || time > now + 60000) return "unknown";
	return now - time <= 120000 ? "ok" : "failed";
}
export function migrationState(
	expected: string[],
	applied: string[] | null,
): { state: DiagnosticState; pending: number | null } {
	if (!expected.length || applied === null)
		return { state: "unknown", pending: null };
	const done = new Set(applied);
	const pending = expected.filter((name) => !done.has(name)).length;
	return { state: pending ? "failed" : "ok", pending };
}
