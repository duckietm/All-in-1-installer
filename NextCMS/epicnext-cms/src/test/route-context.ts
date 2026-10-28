/**
 * The route context Next hands to a route handler, for tests that call one
 * directly. `params` has been a promise since Next 15, and a route with no
 * dynamic segments still receives an empty one, so this is the real call
 * contract rather than a convenience shim.
 *
 * Deliberately self-contained: it does not import from `@/lib/api-handler`,
 * because route tests routinely `vi.mock` that module, and pulling a value out
 * of a mock would fail at runtime.
 */
export function emptyRouteContext(): {
	params: Promise<Record<string, string | string[]>>;
} {
	return { params: Promise.resolve({}) };
}
