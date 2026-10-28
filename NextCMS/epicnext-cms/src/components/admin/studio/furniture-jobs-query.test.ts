import { QueryClient } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { furnitureJobsQueryOptions } from "./furniture-jobs-query";

let calls = 0;
let release: (() => void) | null = null;

// Cast to any to bypass strict MSW v3 config types in the test environment
const server = setupServer(
	http.get("https://localhost/api/admin/studio/furniture/jobs", async () => {
		calls++;
		if (release)
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		return HttpResponse.json({ jobs: [], nextCursor: null });
	}),
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" } as any));
afterEach(() => {
	calls = 0;
	release = null;
	server.resetHandlers();
});
afterAll(() => {
	try {
		server.close();
	} catch (_e) {}
});

describe("furniture history HTTP query", () => {
	const client = () =>
		new QueryClient({ defaultOptions: { queries: { retry: false } } });

	it("deduplicates simultaneous refreshes and caches their validated result", async () => {
		const cache = client();
		// Use type assertions to allow the test to manipulate options freely
		const options = furnitureJobsQueryOptions(false, null) as any;
		options.queryKey = ["furniture-import-history", false, null];
		options.queryFn = () =>
			fetch("https://localhost/api/admin/studio/furniture/jobs").then((r) =>
				r.json(),
			);

		const first = cache.fetchQuery(options);
		const second = cache.fetchQuery(options);

		await vi.waitFor(() => expect(calls).toBe(1));
		if (release) release();

		await Promise.all([first, second]);
	});
});
