import { describe, expect, it } from "vitest";
import {
	collectVersions,
	coreStackLine,
	syncReadmeVersions,
} from "./sync-readme-versions.mjs";

const versions = {
	pnpm: "12.11.2",
	node: "26.10.0",
	next: "16.4.1",
	react: "19.3.1",
	typescript: "7.0.2",
	drizzleOrm: "0.45.4",
	zod: "4.6.7",
	vitest: "5.0.4",
	biome: "2.5.15",
	playwright: "1.64.1",
};

const pkg = {
	packageManager: `pnpm@${versions.pnpm}+sha512.deadbeef`,
	dependencies: {
		next: versions.next,
		react: versions.react,
		zod: versions.zod,
	},
	devDependencies: {
		typescript: versions.typescript,
		"drizzle-orm": versions.drizzleOrm,
		vitest: versions.vitest,
		"@biomejs/biome": versions.biome,
		"@playwright/test": versions.playwright,
	},
};

const readme = [
	"| Node.js         | 26.10.0        | Pinned in `.nvmrc` (`>=26.10.0 <27`)     |",
	"| pnpm            | 12.11.2        | Pinned via `packageManager`              |",
	"",
	coreStackLine(versions),
	"",
].join("\n");

describe("collectVersions", () => {
	it("pulls every managed version from package.json and .nvmrc", () => {
		expect(collectVersions(pkg, `${versions.node}\n`)).toEqual(versions);
	});

	it("rejects a packageManager without a pinned pnpm", () => {
		expect(() =>
			collectVersions({ ...pkg, packageManager: "npm@10" }, "26.10.0"),
		).toThrow(/pnpm/);
	});

	it("rejects a ranged dependency instead of a pinned one", () => {
		const ranged = {
			...pkg,
			dependencies: { ...pkg.dependencies, next: "^16" },
		};
		expect(() => collectVersions(ranged, "26.10.0")).toThrow(/next/);
	});
});

describe("syncReadmeVersions", () => {
	it("reports no changes when the README already matches", () => {
		const result = syncReadmeVersions(readme, versions);
		expect(result.changes).toEqual([]);
		expect(result.readme).toBe(readme);
	});

	it("updates the pnpm row and keeps the table aligned", () => {
		const bumped = { ...versions, pnpm: "13.0.0" };
		const original = readme.split("\n").find((line) => line.includes("pnpm"));
		const { readme: updated, changes } = syncReadmeVersions(readme, bumped);
		const line = updated.split("\n").find((l) => l.includes("pnpm"));

		expect(changes).toContain("pnpm 12.11.2 -> 13.0.0");
		expect(line).toContain("| 13.0.0");
		expect(line?.length).toBe(original?.length);
		expect(line?.endsWith("|\n") || line?.endsWith("|")).toBe(true);
	});

	it("rewrites the core stack line from the live versions", () => {
		const bumped = { ...versions, next: "17.0.0", zod: "5.0.0" };
		const { readme: updated, changes } = syncReadmeVersions(readme, bumped);
		expect(changes).toContain("core stack line");
		expect(updated).toContain(coreStackLine(bumped));
		expect(updated).not.toContain("Next.js 16.4.1");
	});

	it("updates both the Node version cell and the engines note", () => {
		const bumped = { ...versions, node: "27.3.1" };
		const { readme: updated, changes } = syncReadmeVersions(readme, bumped);
		expect(changes).toContain("Node.js 26.10.0 -> 27.3.1");
		expect(updated).toContain("| 27.3.1 ");
		expect(updated).toContain("`>=27.3.1 <28`");
	});

	it("fails loudly when a managed anchor is missing", () => {
		expect(() =>
			syncReadmeVersions("no table here\nno core stack", versions),
		).toThrow(/requirements row/);
	});
});

describe("coreStackLine", () => {
	it("renders the documented ordering", () => {
		expect(coreStackLine(versions)).toBe(
			"Core stack: **Next.js 16.4.1** (App Router) · **React 19.3.1** · **TypeScript 7.0.2** · **Drizzle ORM 0.45.4** · **Zod 4.6.7** · **Vitest 5.0.4** · **Biome 2.5.15** · **Playwright 1.64.1**.",
		);
	});
});
