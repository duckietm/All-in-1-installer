type Change = { key: string; from: unknown; to: unknown };
const sensitive =
	/password|secret|token|otp|recovery|authTicket|two_factor|api_key/i;
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function redact(value: unknown, depth = 0): unknown {
	if (depth > 10) return "[…]";
	if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
	if (!record(value)) return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [
			key,
			sensitive.test(key) ? "[Redacted]" : redact(item, depth + 1),
		]),
	);
}
function parse(value: string) {
	if (value.length > 100000) throw new Error("oversize");
	const parsed: unknown = JSON.parse(value);
	if (!record(parsed)) throw new Error("invalid");
	return parsed;
}
export function readAuditChanges(
	diff: string | null,
	before?: string | null,
	after?: string | null,
) {
	try {
		let changes: Change[];
		if (diff) {
			const parsed = parse(diff);
			changes = Object.entries(parsed).map(([key, value]) => {
				if (!record(value) || !("from" in value || "to" in value))
					throw new Error("invalid");
				return { key, from: value.from, to: value.to };
			});
		} else {
			const previous = before ? parse(before) : {};
			const next = after ? parse(after) : {};
			changes = [...new Set([...Object.keys(previous), ...Object.keys(next)])]
				.filter(
					(key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]),
				)
				.map((key) => ({ key, from: previous[key], to: next[key] }));
		}
		return {
			invalid: false,
			changes: changes.map(({ key, from, to }) => ({
				key,
				from: sensitive.test(key) ? "[Redacted]" : redact(from),
				to: sensitive.test(key) ? "[Redacted]" : redact(to),
			})),
		};
	} catch {
		return { invalid: true, changes: [] as Change[] };
	}
}
export function formatAuditValue(value: unknown) {
	const text =
		value === undefined
			? "∅"
			: typeof value === "string"
				? value
				: JSON.stringify(value, null, 2);
	return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}
