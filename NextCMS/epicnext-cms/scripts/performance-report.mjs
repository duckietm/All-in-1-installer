import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const LIMIT_KEYS = ["route", "maxInitialRawBytes", "maxInitialGzipBytes"];
export function validateBudgets(config) {
	if (
		config?.schemaVersion !== 1 ||
		(config.mode !== "informational" && config.mode !== "enforce") ||
		!Array.isArray(config.routes) ||
		config.routes.length === 0
	)
		throw new Error(
			"Budget config requires schemaVersion 1, mode informational or enforce, and nonempty routes.",
		);
	if (
		Object.keys(config).some(
			(key) => !["schemaVersion", "mode", "routes"].includes(key),
		)
	)
		throw new Error("Unknown budget config field.");
	const seen = new Set();
	for (const entry of config.routes) {
		if (
			!entry ||
			typeof entry.route !== "string" ||
			!/^\/(?:[^?#\s]*)$/.test(entry.route) ||
			seen.has(entry.route) ||
			Object.keys(entry).some((key) => !LIMIT_KEYS.includes(key))
		)
			throw new Error("Invalid or duplicate budget route.");
		seen.add(entry.route);
		for (const key of LIMIT_KEYS.slice(1))
			if (
				entry[key] !== null &&
				(!Number.isSafeInteger(entry[key]) || entry[key] <= 0)
			)
				throw new Error(
					`Invalid ${key} for ${entry.route}: use positive integer bytes or null.`,
				);
	}
	return config;
}

/** Parse Next's generated JSON assignment, never execute the manifest as JavaScript. */
export function parseClientManifest(source, appPath) {
	const assignment =
		/globalThis\.__RSC_MANIFEST\[("(?:[^"\\]|\\.)*")\]\s*=\s*/g;
	const match = assignment.exec(source);
	if (!match || JSON.parse(match[1]) !== appPath)
		throw new Error("Unsupported client-reference manifest assignment.");
	const value = source
		.slice(match.index + match[0].length)
		.trim()
		.replace(/;$/, "");
	return JSON.parse(value);
}

export function normalizeAsset(value) {
	if (typeof value !== "string")
		throw new Error("Non-string JavaScript asset.");
	const clean = value.split(/[?#]/, 1)[0].replace(/^\/_next\//, "");
	if (
		!clean.startsWith("static/") ||
		clean.includes("\\") ||
		clean
			.split("/")
			.some((part) => part === ".." || part === "." || part === "") ||
		!clean.endsWith(".js")
	)
		throw new Error(`Unsupported JavaScript asset: ${value}`);
	return clean;
}

function filesFrom(values) {
	if (!Array.isArray(values))
		throw new Error("Unsupported JavaScript chunk list.");
	return values.map(normalizeAsset);
}

/**
 * Webpack interleaves numeric chunk ids with file names in `chunks` arrays, so
 * a real file has to be separated from its id. An id is rejected by
 * normalizeAsset for the right reason (it has no `static/` prefix and no `.js`
 * suffix), which makes it a usable filter — but only for ids. A malformed
 * *path* must still fail loudly rather than be silently dropped, or a broken
 * manifest would quietly under-report a route's real weight.
 */
function assetFilesFromChunkList(values) {
	if (!Array.isArray(values))
		throw new Error("Unsupported JavaScript chunk list.");
	const files = [];
	for (const value of values) {
		if (typeof value !== "string")
			throw new Error("Non-string JavaScript asset.");
		if (/^\d+$/.test(value)) continue;
		files.push(normalizeAsset(value));
	}
	return files;
}

export function measureRoute({
	budget,
	appPath,
	buildManifest,
	clientManifest,
	readAsset,
}) {
	// Turbopack emits an explicit per-segment `entryJSFiles` list. Webpack does
	// not — it only records chunks per client module — so after the build moved
	// to webpack (3d828a61) every route reported "unavailable" and the report
	// silently stopped measuring anything. Fall back to the same source Next's
	// own `static-routes-info` uses for webpack builds.
	const entries = clientManifest?.entryJSFiles;
	const webpackModules = clientManifest?.clientModules;
	let filesBySource;
	let webpackLayout = false;
	if (entries && typeof entries === "object" && !Array.isArray(entries)) {
		const sourceEntries = Object.keys(entries);
		if (
			!sourceEntries.some((key) =>
				key.replaceAll("\\", "/").endsWith(`/app${appPath}`),
			)
		)
			throw new Error("Route page entry is absent from entryJSFiles.");
		filesBySource = Object.entries(entries);
	} else if (webpackModules && typeof webpackModules === "object") {
		webpackLayout = true;
		// Each `chunks` array is `[chunkId, fileName, chunkId, fileName, ...]`.
		filesBySource = [];
		for (const node of Object.values(webpackModules)) {
			if (!Array.isArray(node?.chunks) || node.chunks.length === 0) continue;
			// One shared origin label instead of the module path: the per-chunk
			// `sources` list is written into report.json, and webpack records
			// absolute node_modules paths for every client module on the route.
			filesBySource.push(["client-module", node.chunks]);
		}
		if (filesBySource.length === 0)
			throw new Error(
				"Neither entryJSFiles nor clientModules chunk data is available; this manifest layout is not supported.",
			);
	} else {
		throw new Error(
			"entryJSFiles is unavailable; this manifest layout is not supported.",
		);
	}
	const bootstrap = filesFrom(
		buildManifest.rootMainFilesTree?.[appPath] ?? buildManifest.rootMainFiles,
	);
	if (bootstrap.length === 0)
		throw new Error("Initial bootstrap chunks are unavailable.");
	const origins = new Map();
	const add = (file, origin) => {
		const sources = origins.get(file) ?? new Set();
		sources.add(origin);
		origins.set(file, sources);
	};
	for (const file of bootstrap) add(file, "bootstrap");
	const readChunkList = webpackLayout ? assetFilesFromChunkList : filesFrom;
	for (const [entry, values] of filesBySource)
		for (const file of readChunkList(values)) add(file, entry);
	const size = (file, sources) => {
		const bytes = readAsset(file);
		return {
			path: file,
			rawBytes: bytes.length,
			gzipBytes: gzipSync(bytes, { level: 9 }).length,
			sources: [...sources].sort(),
		};
	};
	const chunks = [...origins]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([file, sources]) => size(file, sources));
	const polyfills = [...new Set(filesFrom(buildManifest.polyfillFiles ?? []))]
		.filter((file) => !origins.has(file) && !file.endsWith(".module.js"))
		.sort()
		.map((file) => size(file, ["legacy-nomodule-polyfill"]));
	const rawBytes = chunks.reduce((total, file) => total + file.rawBytes, 0);
	const gzipBytes = chunks.reduce((total, file) => total + file.gzipBytes, 0);
	const exceeded = [];
	if (
		budget.maxInitialRawBytes !== null &&
		rawBytes > budget.maxInitialRawBytes
	)
		exceeded.push("raw");
	if (
		budget.maxInitialGzipBytes !== null &&
		gzipBytes > budget.maxInitialGzipBytes
	)
		exceeded.push("gzip");
	return {
		route: budget.route,
		appPath,
		status: exceeded.length ? "over-budget" : "measured",
		initial: { chunkCount: chunks.length, rawBytes, gzipBytes, chunks },
		legacyPolyfills: {
			rawBytes: polyfills.reduce((n, f) => n + f.rawBytes, 0),
			gzipBytes: polyfills.reduce((n, f) => n + f.gzipBytes, 0),
			chunks: polyfills,
		},
		budget: {
			maxInitialRawBytes: budget.maxInitialRawBytes,
			maxInitialGzipBytes: budget.maxInitialGzipBytes,
		},
		exceeded,
	};
}

function jsonFile(file) {
	return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}
function within(root, relative) {
	const resolved = path.resolve(root, relative);
	if (!resolved.startsWith(path.resolve(root) + path.sep))
		throw new Error("Manifest path escapes the build directory.");
	return resolved;
}
export function collectReport(nextDir, config, metadata = {}) {
	validateBudgets(config);
	let routeMap, appMap, manifestError;
	let buildId = null;
	try {
		buildId = readFileSync(path.join(nextDir, "BUILD_ID"), "utf8").trim();
		if (!buildId)
			throw new Error("A completed production BUILD_ID is required.");
		routeMap = jsonFile(path.join(nextDir, "app-path-routes-manifest.json"));
		appMap = jsonFile(path.join(nextDir, "server/app-paths-manifest.json"));
	} catch (error) {
		manifestError = error.message;
	}
	const routes = config.routes.map((budget) => {
		try {
			if (manifestError) throw new Error(manifestError);
			const matches = Object.entries(routeMap)
				.filter(([, route]) => route === budget.route)
				.map(([appPath]) => appPath);
			if (matches.length !== 1)
				throw new Error(
					`Expected one build entry for ${budget.route}, found ${matches.length}.`,
				);
			const appPath = matches[0],
				serverEntry = appMap[appPath];
			if (typeof serverEntry !== "string" || !serverEntry.endsWith("/page.js"))
				throw new Error("Unsupported server app entry.");
			const clientFile = within(
				path.join(nextDir, "server"),
				serverEntry.replace(/\.js$/, "_client-reference-manifest.js"),
			);
			const clientManifest = parseClientManifest(
				readFileSync(clientFile, "utf8"),
				appPath,
			);
			let buildManifest,
				buildManifestSource = `server/${serverEntry.replace(/\.js$/, "/build-manifest.json")}`;
			try {
				buildManifest = jsonFile(within(nextDir, buildManifestSource));
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
				buildManifestSource = "build-manifest.json";
				buildManifest = jsonFile(path.join(nextDir, buildManifestSource));
			}
			return {
				...measureRoute({
					budget,
					appPath,
					buildManifest,
					clientManifest,
					readAsset: (file) => readFileSync(within(nextDir, file)),
				}),
				manifests: {
					client: path.relative(nextDir, clientFile).split(path.sep).join("/"),
					build: buildManifestSource,
				},
			};
		} catch (error) {
			return {
				route: budget.route,
				status: "unavailable",
				reason: error.message,
				initial: null,
				budget: {
					maxInitialRawBytes: budget.maxInitialRawBytes,
					maxInitialGzipBytes: budget.maxInitialGzipBytes,
				},
			};
		}
	});
	return {
		schemaVersion: 1,
		mode: config.mode,
		generatedAt: new Date().toISOString(),
		buildId,
		commitSha: metadata.commitSha ?? null,
		commitProvenance:
			"Optional PERFORMANCE_COMMIT_SHA supplied by the build caller; not inferred from current checkout.",
		nodeVersion: process.version,
		zlibVersion: process.versions.zlib,
		manifestFormat:
			"Turbopack: client-reference entryJSFiles. Webpack: deduplicated clientModules[*].chunks.",
		definition:
			"Initial entry envelope: deduplicated rootMainFiles bootstrap plus every client chunk this route's client-reference manifest lists, including boundary/loading entries. Turbopack exposes these as entryJSFiles; webpack exposes them only through clientModules[*].chunks, so the same envelope is derived from whichever the build emitted. This is emitted file size, not measured browser traffic or a load-time benchmark.",
		gzip: "Sum of each unique JavaScript file independently compressed with Node gzip level 9. Excludes HTTP headers and shared-cache reuse.",
		excluded:
			"CSS, source maps, images, RSC/HTML payloads, external scripts, async-only chunks absent from the manifest's chunk lists; legacy nomodule polyfills are reported separately.",
		routes,
	};
}

export function markdownReport(report) {
	const modeLine =
		report.mode === "enforce"
			? `Build: ${report.buildId ?? "unavailable"}. Declared commit: ${report.commitSha ?? "not supplied"}. Mode: enforce; an over-budget or unavailable route fails the command and the image build.`
			: `Build: ${report.buildId ?? "unavailable"}. Declared commit: ${report.commitSha ?? "not supplied"}. Mode: informational; exceeded budgets and unavailable metrics do not fail CI.`;
	const lines = [
		"# Route JavaScript size report",
		"",
		report.definition,
		"",
		report.gzip,
		"",
		modeLine,
		"",
		"| Route | State | Unique JS | Raw bytes | Gzip bytes | Raw budget | Gzip budget |",
		"| --- | --- | ---: | ---: | ---: | ---: | ---: |",
	];
	for (const row of report.routes)
		lines.push(
			`| ${row.route} | ${row.status} | ${row.initial?.chunkCount ?? "—"} | ${row.initial?.rawBytes ?? "—"} | ${row.initial?.gzipBytes ?? "—"} | ${row.budget.maxInitialRawBytes ?? "observe"} | ${row.budget.maxInitialGzipBytes ?? "observe"} |`,
		);
	lines.push("", report.excluded, "");
	for (const row of report.routes)
		if (row.reason)
			lines.push(
				`- ${row.route}: unavailable — ${row.reason.replaceAll("\n", " ")}`,
			);
	lines.push(
		"",
		"Exact file lists, provenance and legacy polyfill sizes are in report.json.",
		"",
	);
	return lines.join("\n");
}

export function main(argv = process.argv.slice(2)) {
	const options = {
		"--next-dir": ".next",
		"--config": "scripts/performance-budgets.json",
		"--output-dir": ".next/performance-report",
	};
	for (let i = 0; i < argv.length; i += 2) {
		if (!Object.hasOwn(options, argv[i]) || !argv[i + 1])
			throw new Error(
				"Usage: node scripts/performance-report.mjs [--next-dir DIR] [--config FILE] [--output-dir DIR]",
			);
		options[argv[i]] = argv[i + 1];
	}
	const config = validateBudgets(jsonFile(options["--config"]));
	const report = collectReport(options["--next-dir"], config, {
		commitSha: process.env.PERFORMANCE_COMMIT_SHA || null,
	});
	mkdirSync(options["--output-dir"], { recursive: true });
	writeFileSync(
		path.join(options["--output-dir"], "report.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	writeFileSync(
		path.join(options["--output-dir"], "report.md"),
		markdownReport(report),
	);
	console.log(markdownReport(report));
	for (const row of report.routes)
		if (row.status !== "measured")
			console.warn(
				`Performance warning: ${row.route} ${row.status}${row.reason ? `: ${row.reason}` : ""}`,
			);
	if (report.mode === "enforce") {
		const failed = report.routes.filter((row) => row.status !== "measured");
		if (failed.length > 0) {
			console.error(
				`Performance budgets enforced: ${failed
					.map((row) => `${row.route} (${row.status})`)
					.join(", ")}`,
			);
			process.exitCode = 1;
		}
	}
	return report;
}
if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		main();
	} catch (error) {
		console.error(
			`Performance report configuration/output error: ${error.message}`,
		);
		process.exitCode = 1;
	}
}
