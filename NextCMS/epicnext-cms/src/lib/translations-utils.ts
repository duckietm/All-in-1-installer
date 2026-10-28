// Shared helpers used by every translations editor (CMS messages, Nitro JSON5
// configs, JSON badge files). Editors operate on a flat `key -> string` map
// for ease of search/filter/render; the on-disk format is the nested object
// produced by `unflattenObject`.

export function flattenObject(
	obj: Record<string, unknown>,
	prefix = "",
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(obj)) {
		const fullKey = prefix ? `${prefix}.${key}` : key;
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			Object.assign(
				result,
				flattenObject(value as Record<string, unknown>, fullKey),
			);
		} else {
			result[fullKey] = String(value ?? "");
		}
	}
	return result;
}

export function unflattenObject(
	flat: Record<string, string>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(flat)) {
		const parts = key.split(".");
		let current: Record<string, unknown> = result;
		for (let i = 0; i < parts.length - 1; i++) {
			if (!current[parts[i]] || typeof current[parts[i]] !== "object") {
				current[parts[i]] = {};
			}
			current = current[parts[i]] as Record<string, unknown>;
		}
		current[parts[parts.length - 1]] = value;
	}
	return result;
}
