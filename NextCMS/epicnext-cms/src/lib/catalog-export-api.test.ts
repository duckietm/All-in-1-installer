// @ts-nocheck
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	after: vi.fn(),
	auth: vi.fn(),
	csrf: vi.fn(),
}));
vi.mock("next/server", async (original) => ({
	...(await original<typeof import("next/server")>()),
	after: mocks.after,
}));
vi.mock("@/lib/admin/authorization-events", () => ({
	logAuthorizationEvent: vi.fn(),
}));
vi.mock("@/lib/foundation/security", () => ({ validateCsrfToken: mocks.csrf }));
vi.mock("@/lib/permissions", () => ({
	getApiAdminContext: mocks.auth,
	canAccess: () => true,
}));
vi.mock("@/lib/server-log", () => ({ logServerError: vi.fn() }));

import { withAdmin } from "./api-handler";
import { catalogExportQueue } from "./services/catalog-git-queue";

describe("catalog API completion tracking", () => {
	beforeEach(async () => {
		vi.stubEnv("CATALOG_GIT_CHECKOUT", "/catalog");
		vi.stubEnv(
			"CATALOG_GIT_STATE_DIR",
			await mkdtemp(path.join(os.tmpdir(), "catalog-api-")),
		);
		mocks.auth.mockResolvedValue({
			session: { user: { id: 1, rank: 7 } },
			permissions: [],
		});
		mocks.csrf.mockResolvedValue(true);
		mocks.after.mockReset();
	});
	afterEach(() => vi.unstubAllEnvs());
	it("waits for the last SSE event before making changes publishable", async () => {
		let end: (() => void) | undefined;
		const response = new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(
						new TextEncoder().encode('data: {"type":"progress"}\n\n'),
					);
					end = () => controller.close();
				},
			}),
			{ headers: { "content-type": "text/event-stream" } },
		);
		const route = withAdmin({}, async () => response);
		const returned = await route(
			new NextRequest("http://localhost/cms_api/admin/import/furni/batch", {
				method: "POST",
			}),
		);
		expect(await catalogExportQueue().batch()).toBeNull();
		const complete = mocks.after.mock.calls[0][0]();
		end?.();
		await returned.text();
		await complete;
		expect(await catalogExportQueue().batch()).toHaveLength(1);
	});
	it("does not queue unauthenticated requests or reads", async () => {
		const handler = vi.fn(async () => new Response("{}"));
		const route = withAdmin({}, handler);
		mocks.auth.mockResolvedValueOnce(null);
		expect(
			(
				await route(
					new NextRequest("http://localhost/cms_api/admin/import/furni", {
						method: "POST",
					}),
				)
			).status,
		).toBe(401);
		expect(handler).not.toHaveBeenCalled();
		await route(new NextRequest("http://localhost/cms_api/admin/import/furni"));
		expect(await catalogExportQueue().batch()).toHaveLength(0);
	});
});
