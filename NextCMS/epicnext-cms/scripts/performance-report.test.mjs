import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
	collectReport,
	markdownReport,
	measureRoute,
	normalizeAsset,
	parseClientManifest,
	validateBudgets,
} from "./performance-report.mjs";

const budget = {
	route: "/news",
	maxInitialRawBytes: 1000,
	maxInitialGzipBytes: 1000,
};
const config = { schemaVersion: 1, mode: "informational", routes: [budget] };
const appPath = "/(site)/news/page";
const buildManifest = {
	rootMainFiles: ["static/chunks/runtime.js", "static/chunks/shared.js"],
	polyfillFiles: ["static/chunks/polyfill.js"],
};
const clientManifest = {
	entryJSFiles: {
		"[project]/src/app/layout": ["static/chunks/shared.js"],
		"[project]/src/app/error": ["static/chunks/boundary.js"],
		"[project]/src/app/(site)/news/page": [
			"/_next/static/chunks/shared.js?dpl=old",
			"static/chunks/page.js",
		],
	},
	clientModules: { dynamic: { chunks: ["static/chunks/dynamic-only.js"] } },
};
const files = {
	"static/chunks/runtime.js": Buffer.from("const runtime = true;"),
	"static/chunks/shared.js": Buffer.from("shared".repeat(50)),
	"static/chunks/boundary.js": Buffer.from("boundary"),
	"static/chunks/page.js": Buffer.from("page"),
	"static/chunks/polyfill.js": Buffer.from("legacy"),
};
const folders = [];
afterEach(() => {
	for (const folder of folders.splice(0))
		rmSync(folder, { recursive: true, force: true });
});
function fixture() {
	const dir = mkdtempSync(path.join(tmpdir(), "route-js-report-"));
	folders.push(dir);
	const write = (relative, value) => {
		const file = path.join(dir, relative);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(
			file,
			typeof value === "string" || Buffer.isBuffer(value)
				? value
				: JSON.stringify(value),
		);
	};
	write("BUILD_ID", "fixture-build");
	write("app-path-routes-manifest.json", { [appPath]: "/news" });
	write("server/app-paths-manifest.json", {
		[appPath]: "app/(site)/news/page.js",
	});
	write(
		"server/app/(site)/news/page_client-reference-manifest.js",
		`globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST[${JSON.stringify(appPath)}] = ${JSON.stringify(clientManifest)};`,
	);
	write("server/app/(site)/news/page/build-manifest.json", buildManifest);
	for (const [file, bytes] of Object.entries(files)) write(file, bytes);
	return { dir, write };
}

describe("route JS measurement", () => {
	it("requires a completed production build instead of measuring development output", () => {
		const { dir } = fixture();
		rmSync(path.join(dir, "BUILD_ID"));
		expect(collectReport(dir, config).routes[0]).toMatchObject({
			status: "unavailable",
			initial: null,
		});
	});
	it("does not guess between multiple app paths for one route", () => {
		const { dir, write } = fixture();
		write("app-path-routes-manifest.json", {
			[appPath]: "/news",
			"/(other)/news/page": "/news",
		});
		expect(collectReport(dir, config).routes[0]).toMatchObject({
			status: "unavailable",
			initial: null,
		});
	});

	it("deduplicates normalized shared chunks within each route and sums per-file gzip", () => {
		const row = measureRoute({
			budget,
			appPath,
			buildManifest,
			clientManifest,
			readAsset: (file) => files[file],
		});
		const initial = Object.entries(files).filter(
			([file]) => !file.includes("polyfill"),
		);
		expect(row.initial.chunkCount).toBe(4);
		expect(row.initial.rawBytes).toBe(
			initial.reduce((n, [, bytes]) => n + bytes.length, 0),
		);
		expect(row.initial.gzipBytes).toBe(
			initial.reduce(
				(n, [, bytes]) => n + gzipSync(bytes, { level: 9 }).length,
				0,
			),
		);
		expect(
			row.initial.chunks.find((f) => f.path.endsWith("shared.js")).sources,
		).toHaveLength(3);
		expect(row.initial.chunks.some((f) => f.path.includes("dynamic"))).toBe(
			false,
		);
		expect(row.legacyPolyfills.rawBytes).toBe(6);
	});
	it("uses route-specific bootstrap instead of unrelated global bootstrap", () => {
		const row = measureRoute({
			budget,
			appPath,
			buildManifest: {
				...buildManifest,
				rootMainFiles: ["static/chunks/not-used.js"],
				rootMainFilesTree: { [appPath]: ["static/chunks/runtime.js"] },
			},
			clientManifest,
			readAsset: (file) => files[file],
		});
		expect(row.initial.chunkCount).toBe(4);
	});
	it("reports exceeded budgets without throwing", () => {
		expect(
			measureRoute({
				budget: { ...budget, maxInitialRawBytes: 1, maxInitialGzipBytes: 1 },
				appPath,
				buildManifest,
				clientManifest,
				readAsset: (file) => files[file],
			}),
		).toMatchObject({ status: "over-budget", exceeded: ["raw", "gzip"] });
	});
	it("parses generated data without executing trailing JavaScript", () => {
		expect(
			parseClientManifest(
				`globalThis.__RSC_MANIFEST[${JSON.stringify(appPath)}] = {"entryJSFiles":{}};`,
				appPath,
			),
		).toEqual({ entryJSFiles: {} });
		expect(() =>
			parseClientManifest(
				`globalThis.__RSC_MANIFEST[${JSON.stringify(appPath)}] = {}; globalThis.executed = true;`,
				appPath,
			),
		).toThrow();
	});
	it.each([
		"../secrets.js",
		"static/../secrets.js",
		"https://cdn.test/a.js",
		"static\\secret.js",
		"static/chunks/a.css",
	])("rejects unsupported asset paths %s", (file) => {
		expect(() => normalizeAsset(file)).toThrow();
	});
	it("reports exact emitted bytes with build provenance", () => {
		const { dir } = fixture();
		expect(collectReport(dir, config, { commitSha: "abc1234" })).toMatchObject({
			buildId: "fixture-build",
			commitSha: "abc1234",
			routes: [{ status: "measured", initial: { chunkCount: 4 } }],
		});
	});
	it("keeps unavailable manifests separate from a zero metric", () => {
		const { dir } = fixture();
		rmSync(
			path.join(
				dir,
				"server/app/(site)/news/page_client-reference-manifest.js",
			),
		);
		const row = collectReport(dir, config).routes[0];
		expect(row.status).toBe("unavailable");
		expect(row.initial).toBeNull();
	});
	it("does not publish partial totals when one referenced asset is missing", () => {
		const { dir } = fixture();
		rmSync(path.join(dir, "static/chunks/page.js"));
		expect(collectReport(dir, config).routes[0]).toMatchObject({
			status: "unavailable",
			initial: null,
		});
	});
	it("falls back to the root build manifest only when the route manifest is absent", () => {
		const { dir, write } = fixture();
		write("build-manifest.json", buildManifest);
		rmSync(path.join(dir, "server/app/(site)/news/page/build-manifest.json"));
		expect(collectReport(dir, config).routes[0].manifests.build).toBe(
			"build-manifest.json",
		);
	});
	it("marks unsupported entryJSFiles layouts unavailable", () => {
		const { dir, write } = fixture();
		write(
			"server/app/(site)/news/page_client-reference-manifest.js",
			`globalThis.__RSC_MANIFEST[${JSON.stringify(appPath)}] = {};`,
		);
		expect(collectReport(dir, config).routes[0].status).toBe("unavailable");
	});
	// The regression: after the build moved to webpack (3d828a61) the manifest
	// has no entryJSFiles, only clientModules[*].chunks. Every route then
	// reported "unavailable" and the report measured nothing at all while still
	// exiting zero, so the budgets silently stopped being enforced.
	describe("webpack manifests without entryJSFiles", () => {
		const webpackManifest = {
			clientModules: {
				"[project]/src/components/header.tsx": {
					chunks: [
						"4269",
						"static/chunks/4269-shared.js?dpl=abc",
						"6726",
						"static/chunks/header-entry.js?dpl=abc",
					],
				},
				"[project]/src/app/(site)/news/page.tsx": {
					chunks: [
						"4269",
						"static/chunks/4269-shared.js?dpl=abc",
						"7777",
						"/_next/static/chunks/page.js?dpl=abc",
					],
				},
				// Async-only modules are recorded with an empty chunk list.
				"[project]/src/components/lazy.tsx": { chunks: [] },
			},
		};
		const webpackFiles = {
			// buildManifest.rootMainFiles lists runtime.js and shared.js, so both
			// bootstrap assets must exist or the read fails.
			"static/chunks/runtime.js": Buffer.from("const runtime = true;"),
			"static/chunks/shared.js": Buffer.from("bootstrap".repeat(10)),
			"static/chunks/4269-shared.js": Buffer.from("shared".repeat(50)),
			"static/chunks/header-entry.js": Buffer.from("header"),
			"static/chunks/page.js": Buffer.from("page"),
			"static/chunks/polyfill.js": Buffer.from("legacy"),
		};
		const measure = () =>
			measureRoute({
				budget,
				appPath,
				buildManifest,
				clientManifest: webpackManifest,
				readAsset: (file) => webpackFiles[file],
			});

		it("derives the envelope from clientModules and ignores chunk ids", () => {
			const row = measure();
			expect(row.status).toBe("measured");
			// 2 bootstrap + shared + header-entry + page; the numeric chunk ids
			// are not assets and must not throw or be counted.
			expect(row.initial.chunkCount).toBe(5);
			expect(row.initial.chunks.map((f) => f.path).sort()).toEqual([
				"static/chunks/4269-shared.js",
				"static/chunks/header-entry.js",
				"static/chunks/page.js",
				"static/chunks/runtime.js",
				"static/chunks/shared.js",
			]);
			// Same bytes as the Turbopack fixture would produce for these files.
			expect(row.initial.rawBytes).toBe(
				Object.values(webpackFiles)
					.filter((b) => !b.includes("legacy"))
					.reduce((n, b) => n + b.length, 0),
			);
		});

		it("counts a chunk reached by several client modules only once", () => {
			const shared = measure().initial.chunks.find(
				(f) => f.path === "static/chunks/4269-shared.js",
			);
			expect(shared).toBeDefined();
			expect(measure().initial.chunkCount).toBe(5);
		});

		it("does not leak absolute module paths into the report", () => {
			const sources = new Set(
				measure().initial.chunks.flatMap((chunk) => chunk.sources),
			);
			// Only the two known origin labels; no node_modules path may appear.
			expect([...sources].sort()).toEqual(["bootstrap", "client-module"]);
		});

		it("still fails rather than under-reporting a malformed chunk path", () => {
			expect(() =>
				measureRoute({
					budget,
					appPath,
					buildManifest,
					clientManifest: {
						clientModules: {
							x: { chunks: ["static/chunks/../../etc/passwd"] },
						},
					},
					readAsset: (file) => webpackFiles[file],
				}),
			).toThrow("Unsupported JavaScript asset");
		});

		it("reports unavailable when webpack recorded no chunks at all", () => {
			expect(() =>
				measureRoute({
					budget,
					appPath,
					buildManifest,
					clientManifest: { clientModules: { x: { chunks: [] } } },
					readAsset: (file) => webpackFiles[file],
				}),
			).toThrow("Neither entryJSFiles nor clientModules");
		});

		it("prefers entryJSFiles when a manifest carries both", () => {
			// A future Next version could emit both; the explicit list wins
			// because it is per-segment and therefore the tighter envelope.
			const row = measureRoute({
				budget,
				appPath,
				buildManifest,
				clientManifest: {
					...webpackManifest,
					entryJSFiles: {
						"[project]/src/app/(site)/news/page": ["static/chunks/page.js"],
					},
				},
				readAsset: (file) => webpackFiles[file],
			});
			expect(row.initial.chunkCount).toBe(3);
		});
	});
	it("does not deduplicate shared files across independent cold route totals", () => {
		const row = measureRoute({
			budget,
			appPath,
			buildManifest,
			clientManifest,
			readAsset: (file) => files[file],
		});
		const another = measureRoute({
			budget: { ...budget, route: "/other" },
			appPath,
			buildManifest,
			clientManifest,
			readAsset: (file) => files[file],
		});
		expect(another.initial.rawBytes).toBe(row.initial.rawBytes);
	});
	it("rejects invalid threshold schemas instead of silently dropping limits", () => {
		for (const limit of [-1, 0, 1.5, "100", undefined])
			expect(() =>
				validateBudgets({
					...config,
					routes: [{ ...budget, maxInitialRawBytes: limit }],
				}),
			).toThrow();
		expect(() =>
			validateBudgets({ ...config, routes: [budget, budget] }),
		).toThrow();
		expect(validateBudgets({ ...config, mode: "enforce" }).mode).toBe(
			"enforce",
		);
		expect(() => validateBudgets({ ...config, mode: "strict" })).toThrow();
		expect(() => validateBudgets({ ...config, typo: true })).toThrow();
	});
	it("emits warnings and artifacts with exit zero when a build is unavailable", () => {
		const { dir, write } = fixture();
		write("budgets.json", config);
		const run = spawnSync(
			process.execPath,
			[
				"scripts/performance-report.mjs",
				"--next-dir",
				path.join(dir, "missing"),
				"--config",
				path.join(dir, "budgets.json"),
				"--output-dir",
				path.join(dir, "reports"),
			],
			{ encoding: "utf8" },
		);
		expect(run.status).toBe(0);
		expect(run.stderr).toContain("Performance warning:");
		expect(run.stdout).toContain("unavailable");
	});
	it("exits nonzero for invalid configuration", () => {
		const { dir, write } = fixture();
		write("budgets.json", {
			...config,
			routes: [{ ...budget, maxInitialRawBytes: -1 }],
		});
		const run = spawnSync(
			process.execPath,
			[
				"scripts/performance-report.mjs",
				"--next-dir",
				dir,
				"--config",
				path.join(dir, "budgets.json"),
				"--output-dir",
				path.join(dir, "reports"),
			],
			{ encoding: "utf8" },
		);
		expect(run.status).toBe(1);
	});
	it("labels markdown with the envelope definition, never as loading time", () => {
		const { dir } = fixture();
		const markdown = markdownReport(collectReport(dir, config));
		expect(markdown).toContain("not measured browser traffic");
		expect(markdown).toContain("Raw bytes");
	});
	describe("enforce mode", () => {
		const run = (dir, budgets) => {
			const write = (relative, value) => {
				const file = path.join(dir, relative);
				mkdirSync(path.dirname(file), { recursive: true });
				writeFileSync(file, JSON.stringify(value));
			};
			write("budgets.json", budgets);
			return spawnSync(
				process.execPath,
				[
					"scripts/performance-report.mjs",
					"--next-dir",
					dir,
					"--config",
					path.join(dir, "budgets.json"),
					"--output-dir",
					path.join(dir, "reports"),
				],
				{ encoding: "utf8" },
			);
		};
		it("passes when every route is measured within budget", () => {
			const enforce = { ...config, mode: "enforce" };
			const runResult = run(fixture().dir, enforce);
			expect(runResult.status).toBe(0);
			expect(runResult.stdout).toContain("Mode: enforce");
			expect(runResult.stderr).not.toContain("Performance budgets enforced");
		});
		it("fails when a route is over budget", () => {
			const enforce = {
				schemaVersion: 1,
				mode: "enforce",
				routes: [{ ...budget, maxInitialRawBytes: 1, maxInitialGzipBytes: 1 }],
			};
			const runResult = run(fixture().dir, enforce);
			expect(runResult.status).toBe(1);
			expect(runResult.stderr).toContain("Performance budgets enforced");
			expect(runResult.stderr).toContain("/news (over-budget)");
		});
		it("fails when a route cannot be measured, so broken manifests do not pass quietly", () => {
			const enforce = { ...config, mode: "enforce" };
			const runResult = run(path.join(fixture().dir, "missing"), enforce);
			expect(runResult.status).toBe(1);
			expect(runResult.stderr).toContain("/news (unavailable)");
		});
	});
});
