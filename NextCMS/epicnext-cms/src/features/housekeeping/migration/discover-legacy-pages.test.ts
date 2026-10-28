import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverLegacyPages } from "./discover-legacy-pages";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, { force: true, recursive: true });
	}
});

function createRouteTree(files: readonly string[]): string {
	const root = mkdtempSync(join(tmpdir(), "housekeeping-routes-"));
	temporaryRoots.push(root);

	for (const file of files) {
		const path = join(root, file);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, "export default function Page() {}\n");
	}

	return root;
}

describe("discoverLegacyPages", () => {
	it("discovers the exact legacy administration inventory", () => {
		const pages = discoverLegacyPages();

		expect(pages).toHaveLength(147);
		expect(pages).toContainEqual({
			surface: "admin",
			legacyPath: "/admin/users/:id/edit",
			sourceFile: "src/app/admin/users/[id]/edit/page.tsx",
		});
		expect(pages).toContainEqual({
			surface: "admin",
			legacyPath: "/admin/referrals",
			sourceFile: "src/app/admin/referrals/page.tsx",
		});
		expect(pages).toContainEqual({
			surface: "admin",
			legacyPath: "/admin/daily-rewards",
			sourceFile: "src/app/admin/daily-rewards/page.tsx",
		});
		expect(pages).toContainEqual({
			surface: "mod",
			legacyPath: "/mod/cfh/:id",
			sourceFile: "src/app/mod/cfh/[id]/page.tsx",
		});
	});

	it("discovers root administration and moderation routes", () => {
		expect(discoverLegacyPages()).toEqual(
			expect.arrayContaining([
				{
					surface: "admin",
					legacyPath: "/admin",
					sourceFile: "src/app/admin/page.tsx",
				},
				{
					surface: "mod",
					legacyPath: "/mod",
					sourceFile: "src/app/mod/page.tsx",
				},
			]),
		);
	});

	it("discovers root routes in a controlled route tree", () => {
		const root = createRouteTree([
			"src/app/admin/page.tsx",
			"src/app/mod/page.tsx",
		]);

		expect(discoverLegacyPages(root)).toEqual([
			{
				surface: "admin",
				legacyPath: "/admin",
				sourceFile: "src/app/admin/page.tsx",
			},
			{
				surface: "mod",
				legacyPath: "/mod",
				sourceFile: "src/app/mod/page.tsx",
			},
		]);
	});
	it("sorts a controlled route tree by surface, route, then source file", () => {
		const root = createRouteTree([
			"src/app/mod/zebra/page.tsx",
			"src/app/admin/users/[id]/page.tsx",
			"src/app/admin/(hidden)/alpha/page.tsx",
			"src/app/admin/users/[...slug]/page.tsx",
			"src/app/mod/(group)/aardvark/page.tsx",
		]);

		expect(discoverLegacyPages(root)).toEqual([
			{
				surface: "admin",
				legacyPath: "/admin/alpha",
				sourceFile: "src/app/admin/(hidden)/alpha/page.tsx",
			},
			{
				surface: "admin",
				legacyPath: "/admin/users/:id",
				sourceFile: "src/app/admin/users/[id]/page.tsx",
			},
			{
				surface: "admin",
				legacyPath: "/admin/users/:slug*",
				sourceFile: "src/app/admin/users/[...slug]/page.tsx",
			},
			{
				surface: "mod",
				legacyPath: "/mod/aardvark",
				sourceFile: "src/app/mod/(group)/aardvark/page.tsx",
			},
			{
				surface: "mod",
				legacyPath: "/mod/zebra",
				sourceFile: "src/app/mod/zebra/page.tsx",
			},
		]);
	});
});
