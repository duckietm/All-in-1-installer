import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/postcss";
import { build } from "esbuild";
import postcss from "postcss";

const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const fixtures = path.join(root, "e2e/ui/fixtures");
const port = Number(process.env.UI_TEST_PORT || 3107);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
	throw Error("Invalid UI_TEST_PORT");
const actions = new Set([
	"@/actions/catalog",
	"@/actions/import-furni",
	"@/actions/events",
	"@/actions/admin-settings",
	"@/actions/admin-table-views",
	"@/actions/article-recovery",
	"@/actions/admin-media",
]);
const nodeStubs = path.join(root, "e2e/ui/node-stubs.mjs");
const cacheDir = path.join(root, "node_modules/.cache/nexst-ui-fixture");
const startedAt = Date.now();

async function listFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const target = path.join(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(target)));
		else files.push(target);
	}
	return files;
}

async function fixtureCacheKey() {
	const files = [
		...(await listFiles(path.join(root, "src"))),
		...(await listFiles(fixtures)),
		nodeStubs,
		path.join(root, "e2e/ui/process-shim.mjs"),
		fileURLToPath(import.meta.url),
		path.join(root, "package.json"),
	].sort();
	const hash = createHash("sha256");
	for (const file of files) {
		hash.update(file.slice(root.length));
		hash.update(await readFile(file));
	}
	return hash.digest("hex");
}

async function readCache(key) {
	try {
		const [js, css] = await Promise.all([
			readFile(path.join(cacheDir, `${key}.app.js`), "utf8"),
			readFile(path.join(cacheDir, `${key}.styles.css`), "utf8"),
		]);
		return { js, css };
	} catch {
		return null;
	}
}

async function writeCache(key, js, css) {
	await mkdir(cacheDir, { recursive: true });
	await Promise.all([
		writeFile(path.join(cacheDir, `${key}.app.js`), js),
		writeFile(path.join(cacheDir, `${key}.styles.css`), css),
	]);
	const stale = await readdir(cacheDir);
	await Promise.all(
		stale
			.filter((name) => !name.startsWith(key))
			.map((name) => unlink(path.join(cacheDir, name))),
	);
}

async function buildFixture() {
	const [bundle, globalCss] = await Promise.all([
		build({
			entryPoints: [path.join(fixtures, "entry.tsx")],
			bundle: true,
			write: false,
			outdir: path.join(root, "test-results/ui-fixture"),
			format: "iife",
			jsx: "automatic",
			alias: {
				"@": path.join(root, "src"),
				"node:async_hooks": nodeStubs,
				"node:child_process": nodeStubs,
				"node:crypto": nodeStubs,
				"node:dns/promises": nodeStubs,
				"node:fs": nodeStubs,
				"node:fs/promises": nodeStubs,
				"node:http": nodeStubs,
				"node:net": nodeStubs,
				"node:os": nodeStubs,
				"node:path": nodeStubs,
				"node:url": nodeStubs,
				"node:util": nodeStubs,
			},
			define: {
				"process.env.NODE_ENV": '"production"',
				"process.env.SKIP_ENV_VALIDATION": '"1"',
			},
			inject: [path.join(root, "e2e/ui/process-shim.mjs")],
			plugins: [
				{
					name: "server-contracts",
					setup(build) {
						build.onResolve(
							{ filter: /^next\/navigation$|^next\/link$|^@\/actions\// },
							(args) => {
								if (args.path === "next/navigation")
									return { path: path.join(fixtures, "navigation.ts") };
								if (args.path === "next/link")
									return { path: path.join(fixtures, "next-link.tsx") };
								if (actions.has(args.path))
									return { path: path.join(fixtures, "server-actions.ts") };
								throw Error(
									`Unexpected server action in UI fixture: ${args.path}`,
								);
							},
						);
						build.onResolve(
							{ filter: /^@\/lib\/db$|^mysql2|^next\/headers$/ },
							(args) => {
								throw Error(
									`Database or server dependency forbidden in UI fixture: ${args.path}`,
								);
							},
						);
					},
				},
			],
		}),
		postcss([tailwind({ base: root })])
			.process(await readFile(path.join(root, "src/app/globals.css"), "utf8"), {
				from: path.join(root, "src/app/globals.css"),
			})
			.then((result) => result.css),
	]);
	const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
	const css =
		globalCss +
		"\n" +
		bundle.outputFiles
			.filter((file) => file.path.endsWith(".css"))
			.map((file) => file.text)
			.join("\n");
	return { js, css };
}

const cacheKey = await fixtureCacheKey();
let assets = await readCache(cacheKey);
if (assets) {
	console.log(
		`[fixture] reusing cached bundle ${cacheKey.slice(0, 12)} (${Date.now() - startedAt}ms)`,
	);
} else {
	assets = await buildFixture();
	await writeCache(cacheKey, assets.js, assets.css);
	console.log(
		`[fixture] built bundle ${cacheKey.slice(0, 12)} in ${Date.now() - startedAt}ms`,
	);
}
const { js, css } = assets;
const html =
	'<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="csrf-token" content="' +
	"a".repeat(64) +
	'"><title>UI verification fixture</title><link rel="stylesheet" href="/fixture/styles.css"></head><body><div id="root"></div><script src="/fixture/app.js"></script></body></html>';
const cover =
	'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="160" viewBox="0 0 720 160"><rect width="720" height="160" fill="#334155"/><circle cx="620" cy="80" r="48" fill="#f59e0b"/></svg>';
const jobs = new Map();
const views = [];
const json = (res, value, status = 200) => {
	res.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(value));
};
const server = createServer(async (req, res) => {
	try {
		const url = new URL(req.url, "http://127.0.0.1");
		if (url.pathname === "/fixture/reset") {
			jobs.clear();
			views.length = 0;
			return json(res, { ok: true });
		}
		if (url.pathname === "/health") return json(res, { ready: true });
		if (url.pathname === "/fixture/styles.css") {
			res.setHeader("content-type", "text/css");
			return res.end(css);
		}
		if (url.pathname === "/fixture/app.js") {
			res.setHeader("content-type", "application/javascript");
			return res.end(js);
		}
		if (url.pathname === "/fixture/cover.svg") {
			res.setHeader("content-type", "image/svg+xml");
			return res.end(cover);
		}
		if (url.pathname.startsWith("/vendor/tinymce/")) {
			const assetRoot = path.join(root, "node_modules/tinymce");
			const asset = path.resolve(
				assetRoot,
				url.pathname.slice("/vendor/tinymce/".length),
			);
			if (!asset.startsWith(assetRoot + path.sep)) {
				res.writeHead(400);
				return res.end();
			}
			res.setHeader(
				"content-type",
				asset.endsWith(".css")
					? "text/css"
					: asset.endsWith(".js")
						? "application/javascript"
						: asset.endsWith(".woff")
							? "font/woff"
							: "application/octet-stream",
			);
			return res.end(await readFile(asset));
		}
		let body = {};
		if (req.method === "POST" || req.method === "PATCH") {
			const chunks = [];
			let size = 0;
			for await (const chunk of req) {
				size += chunk.length;
				if (size > 1000000) throw Error("Fixture payload too large");
				chunks.push(chunk);
			}
			body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
		}
		if (url.pathname === "/api/admin/studio/import-jobs") {
			if (req.method === "PATCH") {
				const job = jobs.get(body.id);
				if (job) job.state = "cancelled";
				return json(res, { ok: true, job });
			}
			return json(res, {
				ok: true,
				jobs: [...jobs.values()],
				nextCursor: null,
			});
		}
		if (url.pathname === "/api/admin/import/official/sync-all") {
			if (!jobs.has(body.id))
				jobs.set(body.id, {
					id: body.id,
					userId: 7,
					createdAt: "2030-01-01T12:00:00.000Z",
					updatedAt: "2030-01-01T12:00:00.000Z",
					state: "queued",
					translate: false,
					syncKind: "official",
					items: [
						{
							id: 0,
							classname: "fixture_chair",
							name: "Fixture chair",
							description: "",
							type: "flooritem",
							category: "other",
							revision: 1,
							state: "pending",
						},
					],
				});
			await new Promise((resolve) => setTimeout(resolve, 150));
			return json(res, { ok: true, job: jobs.get(body.id) });
		}
		if (url.pathname === "/api/media") return json(res, { files: [] });
		if (url.pathname.startsWith("/fixture/actions/")) {
			const name = url.pathname.split("/").at(-1);
			if (name === "load-recovery")
				return json(res, { version: 0, draft: null, revisions: [] });
			if (name === "autosave" || name === "clear-recovery")
				return json(res, { ok: true, version: 1 });
			if (name === "list-views")
				return json(res, { ok: true, data: { views } });
			if (name === "save-view") {
				views.push(body.view ?? body);
				return json(res, { ok: true });
			}
			return json(res, { ok: true, data: {} });
		}
		if (
			[
				"/notifications",
				"/admin/unsaved-harness",
				"/admin/deliveries-harness",
				"/admin/attachment-harness",
				"/admin/studio-harness",
				"/admin/jobs-harness",
				"/admin/settings",
				"/admin/articles/new",
				"/admin/articles/recovery",
				"/admin/events/recovery",
				"/admin/tickets/desk",
				"/admin/import/official",
			].includes(url.pathname)
		) {
			res.setHeader("content-type", "text/html");
			return res.end(html);
		}
		res.writeHead(404);
		res.end("Not found");
	} catch (error) {
		console.error(error);
		res.writeHead(500);
		res.end("Fixture error");
	}
});
server.listen(port, "127.0.0.1", () =>
	console.log(`Isolated UI fixture ready at http://127.0.0.1:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => server.close(() => process.exit(0)));
