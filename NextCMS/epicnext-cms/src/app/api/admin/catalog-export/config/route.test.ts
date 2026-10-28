// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connection: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/api-handler", () => ({
	withAdmin: (options: unknown, handler: unknown) => {
		mocks.guard(options);
		return handler;
	},
}));
vi.mock("@/lib/services/catalog-git-managed", () => ({
	testCatalogConnection: mocks.connection,
}));

import { PERMS } from "@/lib/permission-slugs";
import { emptyRouteContext } from "@/test/route-context";
import { GET, POST } from "./route";

let root: string;
const input = {
	action: "save",
	enabled: true,
	remote: "https://gitea.example/user/catalog",
	branch: "main",
	username: "user",
	token: "test-private-token",
};
const request = (data = input) =>
	new NextRequest("http://localhost/api/admin/catalog-export/config", {
		method: "POST",
		body: JSON.stringify(data),
	});
describe("Gitea configuration endpoint", () => {
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-config-test-"));
		vi.stubEnv("CATALOG_GIT_STATE_DIR", root);
		vi.stubEnv("AUTH_SECRET", "test-secret");
		mocks.connection.mockReset().mockResolvedValue(undefined);
	});
	afterEach(async () => {
		vi.unstubAllEnvs();
		await fs.rm(root, { recursive: true, force: true });
	});
	it("requires settings permission and never returns the token", async () => {
		expect(mocks.guard).toHaveBeenCalledWith({
			permission: PERMS.SETTINGS_EDIT,
		});
		const response = await POST(request(), emptyRouteContext());
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.hasToken).toBe(true);
		expect(data.token).toBeUndefined();
		expect(data.encryptedToken).toBeUndefined();
		expect(
			await fs.readFile(path.join(root, "config.json"), "utf8"),
		).not.toContain(input.token);
		expect(
			await (
				await GET(
					new NextRequest("http://localhost/api/admin/catalog-export/config"),
					emptyRouteContext(),
				)
			).text(),
		).not.toContain(input.token);
	});
	it("does not save unverified enabled configurations", async () => {
		mocks.connection.mockRejectedValue(new Error("Cannot connect"));
		expect((await POST(request(), emptyRouteContext())).status).toBe(400);
		expect(await fs.readdir(root)).toEqual([]);
	});
	it("rejects configuration changes during an export", async () => {
		await fs.writeFile(path.join(root, "worker.lock"), "active");
		expect((await POST(request(), emptyRouteContext())).status).toBe(409);
		expect(mocks.connection).not.toHaveBeenCalled();
	});
	it("prevents moving queued changes to a different repository", async () => {
		await POST(request(), emptyRouteContext());
		await fs.writeFile(path.join(root, "change.pending"), "pending");
		expect(
			(
				await POST(
					request({ ...input, remote: "https://other.example/user/repo" }),
					emptyRouteContext(),
				)
			).status,
		).toBe(409);
	});
});
