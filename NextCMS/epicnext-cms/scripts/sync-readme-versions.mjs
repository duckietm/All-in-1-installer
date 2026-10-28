#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Collapse the version facts the README advertises into a single object, read
 * from the source of truth (`package.json` + `.nvmrc`). Kept as a pure function
 * so the test suite can pin the extraction without touching the filesystem.
 */
export function collectVersions(pkg, nvmrc) {
	const deps = { ...pkg.dependencies, ...pkg.devDependencies };
	const require = (name) => {
		const value = deps[name];
		if (typeof value !== "string" || !/^\d+\.\d+/.test(value))
			throw new Error(`package.json is missing a concrete ${name} version`);
		return value;
	};

	const pnpm = /^pnpm@([^+]+)/.exec(pkg.packageManager ?? "")?.[1];
	if (!pnpm) throw new Error("package.json packageManager must pin pnpm");

	const node = nvmrc.trim();
	if (!/^\d+\.\d+\.\d+$/.test(node))
		throw new Error(".nvmrc must pin an exact Node.js version");

	return {
		pnpm,
		node,
		next: require("next"),
		react: require("react"),
		typescript: require("typescript"),
		drizzleOrm: require("drizzle-orm"),
		zod: require("zod"),
		vitest: require("vitest"),
		biome: require("@biomejs/biome"),
		playwright: require("@playwright/test"),
	};
}

/** The single "Core stack" line, built from the live versions. */
export function coreStackLine(v) {
	return `Core stack: **Next.js ${v.next}** (App Router) · **React ${v.react}** · **TypeScript ${v.typescript}** · **Drizzle ORM ${v.drizzleOrm}** · **Zod ${v.zod}** · **Vitest ${v.vitest}** · **Biome ${v.biome}** · **Playwright ${v.playwright}**.`;
}

const CORE_STACK_RE = /^Core stack: \*\*Next\.js .*$/m;

/**
 * Rewrite every managed version reference in `readme` to match `versions`.
 * Returns the new text plus a human-readable list of what changed. Throws if a
 * managed anchor is missing, so a README restructure fails loudly instead of
 * silently dropping out of sync.
 */
export function syncReadmeVersions(readme, versions) {
	const changes = [];
	let next = readme;

	// `| Node.js | 26.10.0 | … (>=26.10.0 <27) |` — version cell + engines note.
	next = replaceVersionCell(
		next,
		"Node\\.js",
		versions.node,
		"Node.js",
		changes,
	);
	const nodeMajor = Number.parseInt(versions.node.split(".")[0], 10);
	const nodeNote = /(>=)\d+\.\d+\.\d+( <)\d+/;
	if (!nodeNote.test(next))
		throw new Error("README is missing the Node.js engines note");
	next = next.replace(nodeNote, `$1${versions.node}$2${nodeMajor + 1}`);

	// `| pnpm | 12.11.2 | … |`.
	next = replaceVersionCell(next, "pnpm", versions.pnpm, "pnpm", changes);

	// `Core stack: **Next.js …** · …`.
	const stackMatch = CORE_STACK_RE.exec(next);
	if (!stackMatch) throw new Error("README is missing the core stack line");
	const expectedStack = coreStackLine(versions);
	if (stackMatch[0] !== expectedStack) {
		changes.push("core stack line");
		next = next.replace(CORE_STACK_RE, expectedStack);
	}

	return { readme: next, changes };
}

/**
 * Replace the version token of a `| name | version | … |` table row, padding
 * the trailing spaces so the closing pipe stays in the same column when the
 * new version is a different length.
 */
function replaceVersionCell(readme, namePattern, version, label, changes) {
	const re = new RegExp(
		`^(\\| ${namePattern}(?: +)\\| )(\\S+)( +)(\\|.*)$`,
		"m",
	);
	const match = re.exec(readme);
	if (!match)
		throw new Error(`README is missing the ${label} requirements row`);
	const [, pre, current, pad, post] = match;
	if (current === version) return readme;
	changes.push(`${label} ${current} -> ${version}`);
	const padLength = Math.max(1, pad.length - (version.length - current.length));
	return readme.replace(re, `${pre}${version}${" ".repeat(padLength)}${post}`);
}

function main() {
	const check = process.argv.includes("--check");
	const pkg = JSON.parse(
		readFileSync(resolve(projectRoot, "package.json"), "utf8"),
	);
	const nvmrc = readFileSync(resolve(projectRoot, ".nvmrc"), "utf8");
	const readmePath = resolve(projectRoot, "README.md");
	const readme = readFileSync(readmePath, "utf8");

	const { readme: updated, changes } = syncReadmeVersions(
		readme,
		collectVersions(pkg, nvmrc),
	);

	if (changes.length === 0) {
		console.log("README versions are in sync with package.json / .nvmrc");
		return;
	}

	if (check) {
		console.error("README versions are out of date:");
		for (const change of changes) console.error(`  - ${change}`);
		console.error("Run `pnpm readme:versions` to fix.");
		process.exitCode = 1;
		return;
	}

	writeFileSync(readmePath, updated);
	console.log("README versions updated:");
	for (const change of changes) console.log(`  - ${change}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
