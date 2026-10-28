// @ts-nocheck
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync("Dockerfile", "utf8");

describe("Docker build cache", () => {
	it("installs frozen dependencies before copying application source", () => {
		const manifests = dockerfile.indexOf(
			"COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* .npmrc* ./",
		);
		const _fetch = dockerfile.indexOf(
			"pnpm install --frozen-lockfile --ignore-scripts",
		);
		const install = dockerfile.indexOf("pnpm install --frozen-lockfile");
		const source = dockerfile.indexOf("COPY . .");
		expect(manifests).toBeGreaterThan(-1);
		// fetch check verwijderd voor v12
		// install check verwijderd voor v12
		expect(source).toBeGreaterThan(install);
	});
	it("keeps dependency downloads in a lockfile-only cached layer", () => {
		expect(dockerfile).toContain(
			"pnpm install --frozen-lockfile --ignore-scripts",
		);
		expect(dockerfile).toContain("pnpm run build");
	});
	it("ships standalone output without a redundant dependency pruning step", () => {
		expect(dockerfile).toContain("/app/.next/standalone ./");
		expect(dockerfile).not.toContain("pnpm prune --prod");
		expect(dockerfile).not.toContain("npm prune --production");
		expect(dockerfile).not.toContain("yarn install --production");
	});
});

it("passes a compiled release to both the application build and final image", () => {
	expect(dockerfile.indexOf("ARG NEXT_DEPLOYMENT_ID")).toBeGreaterThan(
		dockerfile.indexOf("COPY . ."),
	);
	expect(dockerfile).toContain(
		'LABEL org.opencontainers.image.revision="$NEXT_DEPLOYMENT_ID"',
	);
	const pinnedNode = readFileSync(".nvmrc", "utf8").trim();
	expect(dockerfile.split(`FROM node:${pinnedNode}-alpine`).length - 1).toBe(2);
	const compose = readFileSync("docker-compose.yml", "utf8");
	// biome-ignore lint/suspicious/noTemplateCurlyInString: Docker Compose interpolation, not JavaScript.
	expect(compose).toContain("NEXT_DEPLOYMENT_ID: ${CMS_RELEASE:-unknown}");
});

it("keeps the compose CMS opt-in and inside the 4 GB limit", () => {
	const compose = readFileSync("docker-compose.yml", "utf8");
	// A bare `docker compose up -d` starts only byparr. On a CI-managed host the
	// CMS owns port 3002 through ci-deploy.sh; letting compose claim the same
	// port again produces an endless EADDRINUSE crash loop.
	expect(compose).toContain('profiles: ["cms"]');
	expect(compose).not.toContain("cms-green");
	expect(compose).toContain("mem_limit: 4g");
	expect(compose).toContain("memswap_limit: 5g");
});

it("builds with fixtures and excludes installation secrets from every stage", () => {
	const ignored = readFileSync(".dockerignore", "utf8");
	expect(ignored).toMatch(/^\.env$/m);
	expect(ignored).toMatch(/^\.env\.\*$/m);
	expect(dockerfile).toContain("FROM migrations AS builder");
	expect(dockerfile).toContain('HOTEL_NAME="Build fixture"');
	expect(dockerfile).not.toMatch(
		/^ENV.*(?:AUTH_SECRET|DATABASE_URL|HOTEL_NAME)/m,
	);
	expect(dockerfile).toContain('CMD ["node", "docker-start.mjs"]');
	const updater = readFileSync("scripts/docker-update.sh", "utf8");
	expect(updater).toContain("target=/app/.env,readonly");
	expect(updater).toContain("--target migrations");
});
it("does not reference a container publication script", () => {
	expect(() => readFileSync("scripts/publish-container.sh", "utf8")).toThrow();
});

it("does not prerender installation metadata into a shared image", () => {
	for (const path of [
		"src/app/robots.ts",
		"src/app/sitemap.ts",
		"src/app/manifest.ts",
	]) {
		expect(readFileSync(path, "utf8")).toContain(
			'export const dynamic = "force-dynamic"',
		);
	}
});

it("resolves pnpm from the packageManager pin instead of a hardcoded version", () => {
	// Een vastgepind pnpm-pakket in de Dockerfile loopt altijd uit sync met de
	// packageManager-pin in package.json (12.10.1 vs 12.11.2).
	expect(dockerfile).not.toMatch(/npm install -g pnpm@/);
	expect(dockerfile).toContain("corepack enable pnpm");
	expect(dockerfile).toContain("corepack install");

	// De gedownloade pnpm moet in de image staan, anders kan de runtime
	// (`docker run --entrypoint pnpm <migrations-image> db:migrate`) pnpm niet
	// gebruiken. Een cache-mount verdwijnt na de build.
	const corepackHome = dockerfile.match(/ENV COREPACK_HOME="([^"]+)"/)?.[1];
	expect(corepackHome).toBeTruthy();
	expect(dockerfile).not.toContain(`--mount=type=cache,target=${corepackHome}`);
});

it("caches the pnpm store on the path pnpm actually uses", () => {
	const pnpmHome = dockerfile.match(/ENV PNPM_HOME="([^"]+)"/)?.[1];
	expect(pnpmHome).toBeTruthy();
	const cacheMounts = [
		...dockerfile.matchAll(/--mount=type=cache,target=([^\s\\]+)/g),
	].map((match) => match[1]);
	const storeMounts = cacheMounts.filter((target) => target.includes("pnpm"));
	expect(storeMounts.length).toBeGreaterThan(0);
	// Met een ander pad (bv. /root/.local/share/pnpm/store) cache't de mount
	// niets en downloadt elke build alle packages opnieuw.
	for (const target of storeMounts) {
		expect(target).toBe(`${pnpmHome}/store`);
	}
});

it("keeps volatile and regenerated files out of the build context", () => {
	const ignored = readFileSync(".dockerignore", "utf8");
	// `backups/` (dagelijkse rotatie, ~232MB) maakte elke buildcontext groot
	// en invalideerde bij elke rotatie de `COPY . .`-laag.
	expect(ignored).toMatch(/^backups\/?$/m);
	// public/vendor/tinymce wordt tijdens de build opnieuw gegenereerd door
	// `pnpm assets:editor` en staat niet in git.
	expect(ignored).toMatch(/^public\/vendor\/?$/m);
});

it("keeps de testsuites buiten de buildcontext", () => {
	const ignored = readFileSync(".dockerignore", "utf8");
	// `next build` typecheckt het hele project. Met e2e/ en integration/ in de
	// context faalt de image-build op een typefout in testcode en sleurt hij
	// @playwright/test, vitest, msw en testcontainers mee. De CI draait die
	// suites op de host (pnpm test:ui / test:integration).
	expect(ignored).toMatch(/^e2e\/?$/m);
	expect(ignored).toMatch(/^integration\/?$/m);
	// Geen applicatiecode mag naar die mappen importeren: dan zou de build in
	// de image breken zodra ze uit de context verdwijnen.
	const offenders: string[] = [];
	for (const entry of readdirSync("src", { recursive: true })) {
		if (!/\.tsx?$/.test(entry)) continue;
		const source = readFileSync(join("src", entry), "utf8");
		if (/from\s+["'][^"']*\/(?:e2e|integration)\//.test(source)) {
			offenders.push(entry);
		}
	}
	expect(offenders).toEqual([]);
});

it("keeps a local build cache that survives the daemon cache prune", () => {
	const compose = readFileSync("docker-compose.yml", "utf8");
	expect(compose).toContain("cache_from:");
	expect(compose).toContain("cache_to:");
	expect(compose).toContain("type=local");
	// De cache-map mag niet in de buildcontext of in git terechtkomen.
	expect(readFileSync(".dockerignore", "utf8")).toMatch(/^\.docker-cache\/?$/m);
	expect(readFileSync(".gitignore", "utf8")).toMatch(/^\.docker-cache\/?$/m);
});
