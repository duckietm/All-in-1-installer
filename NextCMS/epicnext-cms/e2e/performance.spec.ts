import { expect, test } from "@playwright/test";

// Caching contract for the anonymous pages. This is deterministic and stays in
// the blocking deploy gate: the perf work relies on the edge/shared cache
// (`src/proxy.ts`) — public content pages advertise a short `s-maxage`, while
// session-dependent pages (login, register, settings) must stay
// `private, no-store`. Timing budgets are advisory and live in
// `e2e/quality/performance.spec.ts`.
test("anonymous content pages advertise a shared cache", async ({
	request,
}) => {
	for (const route of ["/news", "/staff", "/shop"]) {
		const response = await request.get(route);
		const cacheControl = response.headers()["cache-control"] ?? "";
		expect(cacheControl, `GET ${route} cache-control`).toContain("s-maxage");
	}
});

test("session-dependent pages stay private and uncached", async ({
	request,
}) => {
	for (const route of ["/login", "/register"]) {
		const response = await request.get(route);
		const cacheControl = response.headers()["cache-control"] ?? "";
		expect(cacheControl, `GET ${route} cache-control`).toContain("no-store");
		expect(cacheControl, `GET ${route} must not be shared`).not.toContain(
			"s-maxage",
		);
	}
});
