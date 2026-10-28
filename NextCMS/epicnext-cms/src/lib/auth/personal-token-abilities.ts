export type PersonalTokenAbility =
	| "tickets:read"
	| "tickets:write"
	| "articles:write"
	| "radio:read"
	| "radio:write"
	| "badges:read";

/** Sanctum abilities are JSON; invalid data never grants access. */
export function tokenAllowsAbilities(
	encoded: unknown,
	required: readonly PersonalTokenAbility[] = [],
): boolean {
	if (typeof encoded !== "string") return false;
	let abilities: unknown;
	try {
		abilities = JSON.parse(encoded);
	} catch {
		return false;
	}
	if (
		!Array.isArray(abilities) ||
		abilities.length === 0 ||
		!abilities.every(
			(ability) =>
				typeof ability === "string" &&
				ability.length > 0 &&
				ability.trim() === ability,
		)
	)
		return false;
	if (abilities.includes("*")) return true;
	// A caller with no declared scope requires a full-access token.
	return (
		required.length > 0 &&
		required.every((ability) => abilities.includes(ability))
	);
}
