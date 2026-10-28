// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";
import { measureDependency } from "./performance-diagnostics";

const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("./performance-store", () => ({ recordPerformance: mocks.record }));

import { withPublicPagePerformance } from "./public-page-performance";

beforeEach(() => {
	mocks.record.mockClear();
});
it("measures concurrent pages with static labels and never stores props", async () => {
	const render = withPublicPagePerformance(
		"/u/[username]",
		async (props: { username: string }) => {
			await measureDependency("database", async () => 1);
			return props.username;
		},
	);
	expect(
		await Promise.all([
			render({ username: "PrivateName" }),
			render({ username: "AnotherName" }),
		]),
	).toEqual(["PrivateName", "AnotherName"]);
	const records = mocks.record.mock.calls.map(([record]) => record);
	expect(records).toHaveLength(2);
	expect(records[0].metrics.database.count).toBe(1);
	expect(records[0].operationId).not.toBe(records[1].operationId);
	expect(JSON.stringify(records)).not.toMatch(/PrivateName|AnotherName/);
	expect(records[0]).toMatchObject({
		kind: "public-page",
		route: "/u/[username]",
		outcome: "completed",
	});
});
it("preserves framework redirects and labels them separately from failures", async () => {
	const error = Object.assign(new Error("private redirect"), {
		digest: "NEXT_REDIRECT;replace;/login;307;",
	});
	const render = withPublicPagePerformance("/me", async () => {
		throw error;
	});
	await expect(render(undefined)).rejects.toBe(error);
	expect(mocks.record).toHaveBeenCalledWith(
		expect.objectContaining({ outcome: "redirect" }),
	);
	expect(JSON.stringify(mocks.record.mock.calls)).not.toContain("/login");
});
it("keeps missing pages distinct and records dependency failures", async () => {
	const error = Object.assign(new Error("private"), {
		digest: "NEXT_HTTP_ERROR_FALLBACK;404",
	});
	await expect(
		withPublicPagePerformance("/news/[slug]", async () => {
			throw error;
		})(undefined),
	).rejects.toBe(error);
	expect(mocks.record).toHaveBeenCalledWith(
		expect.objectContaining({ outcome: "not-found" }),
	);
});
it("excludes static build invocations without changing their result", async () => {
	vi.stubEnv("NEXT_PHASE", "phase-production-build");
	try {
		expect(
			await withPublicPagePerformance(
				"/news",
				async () => "content",
			)(undefined),
		).toBe("content");
		expect(mocks.record).not.toHaveBeenCalled();
	} finally {
		vi.unstubAllEnvs();
	}
});
