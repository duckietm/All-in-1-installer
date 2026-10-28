import { expect, test } from "@playwright/test";

// ADVISORY suite — run with `pnpm test:e2e:quality`. Warm-page latency depends
// on the host, the edge and the shared data caches, so a slow CI hop can trip
// these budgets without anything being wrong. The cache-control *contract*
// (deterministic) lives in the blocking `e2e/performance.spec.ts`; only the
// timing budgets are advisory.
const BUDGET_MS = Number(process.env.E2E_LOAD_BUDGET_MS || 4000);

const WARM_ROUTES = ["/", "/news", "/staff", "/shop", "/login", "/register"];

for (const route of WARM_ROUTES) {
	test(`${route} responds within the warm budget`, async ({ request }) => {
		await request.get(route); // warm the render + data caches
		const started = Date.now();
		const response = await request.get(route);
		const elapsed = Date.now() - started;
		expect([200, 304]).toContain(response.status());
		expect(
			elapsed,
			`GET ${route} took ${elapsed}ms (budget ${BUDGET_MS}ms)`,
		).toBeLessThan(BUDGET_MS);
	});
}
