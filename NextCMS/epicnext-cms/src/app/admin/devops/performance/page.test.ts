import { createTranslator } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ read: vi.fn(), allowed: false }));
vi.mock("@/lib/permissions", () => ({
	getAdminContext: async () => ({
		session: { user: { rank: 1 } },
		permissions: {},
	}),
	canAccess: () => mocks.allowed,
	PERMS: { DEVOPS_VIEW: "devops.view" },
}));
vi.mock("next/navigation", () => ({
	redirect: () => {
		throw new Error("redirect");
	},
}));
vi.mock("@/lib/performance-store", () => ({ readPerformance: mocks.read }));
vi.mock("@/components/link", () => ({
	default: ({ href }: { href: string }) => createElement("a", { href }),
}));

vi.mock("next-intl/server", () => ({
	getTranslations: async () =>
		createTranslator({
			locale: "en",
			messages: messages.pages.admin.performance,
		}),
}));

import Page from "./page";

it("rejects unauthorized users before reading timing records", async () => {
	await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
		"redirect",
	);
	expect(mocks.read).not.toHaveBeenCalled();
});

it("renders filtered slow records and explains incomplete streaming timings", async () => {
	mocks.allowed = true;
	const metrics = {
		durationMs: 1500,
		database: { count: 2, durationMs: 300, errors: 0 },
		external: { count: 1, durationMs: 400, errors: 1 },
	};
	mocks.read.mockResolvedValue({
		shared: false,
		samples: [
			{
				operationId: "slow-op",
				route: "/api/admin/studio",
				method: "GET",
				status: 200,
				at: 1000,
				streaming: true,
				metrics,
			},
			{
				operationId: "fast-op",
				route: "/api/admin/users",
				method: "GET",
				status: 200,
				at: 1001,
				streaming: false,
				metrics: { ...metrics, durationMs: 10 },
			},
		],
	});
	const html = renderToStaticMarkup(
		await Page({ searchParams: Promise.resolve({ slow: "1" }) }),
	);
	expect(html).toContain("slow-op");
	expect(html).not.toContain("fast-op");
	expect(html).toContain("Streaming response");
	expect(html).toContain("Local diagnostics");
});
it("separates public component outcomes from HTTP response codes", async () => {
	mocks.allowed = true;
	mocks.read.mockResolvedValue({
		shared: false,
		samples: [
			{
				kind: "public-page",
				outcome: "redirect",
				operationId: "public-op",
				route: "/me",
				method: "PAGE",
				status: 200,
				at: 1000,
				streaming: false,
				metrics: {
					durationMs: 2,
					database: { count: 0, durationMs: 0, errors: 0 },
					external: { count: 0, durationMs: 0, errors: 0 },
				},
			},
		],
	});
	const html = renderToStaticMarkup(
		await Page({ searchParams: Promise.resolve({ kind: "public-page" }) }),
	);
	expect(mocks.read).toHaveBeenLastCalledWith("public-page");
	expect(html).toContain("Redirect");
	expect(html).toContain(
		"/admin/devops/performance?kind=public-page&amp;q=&amp;sort=slowest&amp;slow=0",
	);
	expect(html).not.toContain("HTTP 200");
	expect(html).toContain("browser rendering");
});
