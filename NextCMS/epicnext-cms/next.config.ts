import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * This host runs with `vm.overcommit_memory=0` and no swap, so a process that
 * asks for more memory than is free gets OOM-killed by the kernel immediately.
 * The killer picks its victim across the WHOLE machine — an unbounded build can
 * take down the database, nginx and the live release with it.
 *
 * `scripts/with-memory-cap.sh` runs a heavy command in its own cgroup with a
 * hard `MemoryMax`, so only that build dies and the site keeps serving. Every
 * script in package.json goes through it.
 *
 * The one hole that leaves is running the builder by hand: `npx next build`,
 * `pnpm exec next build`, or an IDE/agent task invoking it directly skips the
 * wrapper entirely and is unbounded. This guard closes that. `next build`
 * loads the config, so refusing here stops the build before it allocates
 * anything. See the header of scripts/with-memory-cap.sh.
 */
function assertMemoryCapped(phase: string): void {
	if (phase !== PHASE_PRODUCTION_BUILD) return;
	if (process.env.CMS_MEMORY_CAPPED === "1") return;

	throw new Error(
		[
			"Refusing to run an uncapped production build.",
			"",
			"On this host an unbounded `next build` gets OOM-killed by the kernel,",
			"and the killer may take the database, nginx or the live release with it.",
			"",
			"Use the capped build instead:",
			"    pnpm build",
			"",
			"It runs the builder through scripts/with-memory-cap.sh, which puts it in",
			"its own cgroup with a MemoryMax, so a runaway build fails alone.",
			"",
			"Already inside an isolated environment (Docker, a CI runner) where the",
			"container itself is the boundary? Set CMS_MEMORY_CAPPED=1 explicitly.",
		].join("\n"),
	);
}

const getGitCommit = () => {
	try {
		return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
	} catch {
		return undefined;
	}
};

const securityHeaders = [
	{ key: "X-DNS-Prefetch-Control", value: "on" },
	{
		key: "Strict-Transport-Security",
		value: "max-age=63072000; includeSubDomains; preload",
	},
	{ key: "X-Frame-Options", value: "DENY" },
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{
		key: "Permissions-Policy",
		value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
	},
];

const nextConfig: NextConfig = {
	output: "standalone",
	env: {
		NEXT_PUBLIC_CMS_RELEASE:
			process.env.NEXT_DEPLOYMENT_ID?.trim() || getGitCommit() || "unknown",
	},
	deploymentId: process.env.NEXT_DEPLOYMENT_ID?.trim() || getGitCommit(),
	distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
	reactStrictMode: true,
	compress: true,
	productionBrowserSourceMaps: false,
	// `isomorphic-dompurify` builds a DOM through jsdom on the server. Bundled,
	// it drags jsdom's `browser/default-stylesheet.css` into the server chunk,
	// where the path no longer exists and page-data collection dies with ENOENT
	// on any page that sanitizes HTML. Kept external, Node resolves it from
	// node_modules at runtime and the standalone output traces it in.
	serverExternalPackages: [
		"lzma-wasm",
		"sharp",
		"pino",
		"pino-pretty",
		"isomorphic-dompurify",
	],

	async redirects() {
		return [
			{
				source: "/admin/import",
				destination: "/admin/studio/furni",
				permanent: true,
			},
			{
				source: "/admin/import/badges",
				destination: "/admin/studio/badges",
				permanent: true,
			},
			{
				source: "/admin/import/furni",
				destination: "/admin/studio/furni",
				permanent: true,
			},
			{
				source: "/admin/import/furni/upload",
				destination: "/admin/studio/upload",
				permanent: true,
			},
			{
				source: "/admin/import/clothing",
				destination: "/admin/studio/clothing",
				permanent: true,
			},
			{
				source: "/admin/import/effects",
				destination: "/admin/studio/effects",
				permanent: true,
			},
			{
				source: "/admin/import/pets",
				destination: "/admin/studio/pets",
				permanent: true,
			},
			{
				source: "/admin/import/clone",
				destination: "/admin/studio/clone",
				permanent: true,
			},
			{
				source: "/admin/import/sync",
				destination: "/admin/studio/sync",
				permanent: true,
			},
			{
				source: "/admin/import/repair-icons",
				destination: "/admin/studio/repair-icons",
				permanent: true,
			},
			{
				source: "/admin/import/audit",
				destination: "/admin/studio/audit",
				permanent: true,
			},
		];
	},

	turbopack: {
		ignoreIssue: [
			{
				path: "**/src/lib/**",
			},
		],
	},

	experimental: {
		// Barrel-heavy packages: without this every import pulls the whole
		// module graph into the chunk that first touches it.
		optimizePackageImports: [
			"lucide-react",
			"motion",
			"@dnd-kit/core",
			"@dnd-kit/sortable",
			"@tanstack/react-virtual",
		],
		useTypeScriptCli: true,
		hideLogsAfterAbort: true,
	},

	images: {
		formats: ["image/avif", "image/webp"],
	},

	// The SWF/Nitro image pipeline (src/lib/services/swf, src/lib/services/image-*)
	// pulls shared helpers into several server chunks that webpack reports as a
	// circular dependency between chunks with runtime. The cycle only affects
	// server-side module caching of already-loaded chunks and has no runtime
	// impact, so suppress the noisy warning instead of refactoring the shared
	// helpers (which would risk the hot image path). Revisit if a real deadlock
	// appears.
	webpack(config) {
		config.ignoreWarnings = [
			...(config.ignoreWarnings ?? []),
			/Circular dependency between chunks with runtime/,
		];
		return config;
	},

	async headers() {
		return [
			{
				source: "/(.*)",
				headers: securityHeaders,
			},
			{
				source: "/assets/(.*)",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=31536000, immutable",
					},
				],
			},
			{
				// Nitro client payload (~2.8GB across swf/nitro-assets): without
				// caching every client open re-downloads hundreds of files.
				// Fresh for 7 days, then serve stale + revalidate in background
				// so asset updates still propagate without blocking players.
				source: "/swf/(.*)",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=604800, stale-while-revalidate=2592000",
					},
				],
			},
			{
				source: "/nitro-assets/(.*)",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=604800, stale-while-revalidate=2592000",
					},
				],
			},
			{
				source: "/images/(.*)",
				headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
			},
		];
	},
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Exported as a function so the build phase is known before the config is
// used. next-intl only accepts a plain object, so it is applied here.
export default function config(phase: string) {
	assertMemoryCapped(phase);
	return withNextIntl(nextConfig);
}
