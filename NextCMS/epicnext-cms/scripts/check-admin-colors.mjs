#!/usr/bin/env node

/**
 * Checks admin source files for hardcoded color utilities that should use
 * theme CSS variables instead. Exits 1 on violations.
 *
 * Usage:  node scripts/check-admin-colors.mjs [file ...]
 *   When called with file arguments (by lint-staged), only those files are
 *   checked.  Without arguments, scans all ROOTS.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOTS = [
	"src/app",
	"src/components",
	"src/lib",
	"src/features",
	"src/hooks",
];

const ALLOWLIST = new Set([
	"src/app/admin/favicon/favicon-generator.tsx",
	"src/app/admin/import/clone/import-clone-client.tsx",
	"src/components/admin/catalog/items-shop-preview.tsx",
	"src/components/admin/media-grid.tsx",
	// shadcn/ui primitives — hardcoded colors are intentional design tokens
	"src/components/ui/button.tsx",
	"src/components/ui/badge.tsx",
	"src/components/ui/dialog.tsx",
]);

// Patterns that indicate hardcoded theme colors
const RULES = [
	{
		name: "no-text-white",
		pattern: /text-white(?:\/\d+)?/g,
		message:
			"Use theme text colors (e.g. text-foreground, text-card-foreground)",
	},
	{
		name: "no-bg-white",
		pattern: /bg-white(?:\/\d+)?/g,
		message:
			"Use theme background colors (e.g. bg-background, bg-card, bg-surface)",
	},
	{
		name: "no-text-black",
		pattern: /text-black(?:\/\d+)?/g,
		message:
			"Use theme text colors (e.g. text-foreground, text-card-foreground)",
	},
	{
		name: "no-bg-black-hardcoded",
		pattern: /bg-black(?:\/\d+)?/g,
		message:
			"Use theme overlay vars (e.g. bg-foreground/50) or documented overrides",
	},
	{
		name: "no-gray-palette",
		pattern:
			/(?:text|bg|border|ring)-(?:gray|slate|zinc|neutral|stone)-(?:[1-9]00|50)(?:\/\d+)?/g,
		message: "Use theme CSS variables instead of Tailwind gray palette",
	},
	{
		name: "no-colored-palette",
		pattern:
			/(?:text|bg|border|ring)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:[1-9]00|50)(?:\/\d+)?/g,
		message:
			"Use theme CSS variables (e.g. text-destructive, bg-accent) instead",
	},
];

function sourceFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory()
			? sourceFiles(path)
			: /\.(?:ts|tsx)$/.test(entry.name) &&
					!entry.name.endsWith(".test.ts") &&
					!entry.name.endsWith(".test.tsx")
				? [path]
				: [];
	});
}

const cwd = process.cwd();
const files =
	process.argv.length > 2
		? process.argv.slice(2).map((f) => resolve(f))
		: ROOTS.flatMap((r) => sourceFiles(r));

const violations = [];

for (const file of files) {
	const normalized = relative(cwd, file).replaceAll("\\", "/");
	if (ALLOWLIST.has(normalized)) continue;
	if (normalized.endsWith(".test.ts") || normalized.endsWith(".test.tsx"))
		continue;
	if (!/\.(?:ts|tsx)$/.test(normalized)) continue;

	const source = readFileSync(file, "utf8");
	const lines = source.split("\n");

	for (const rule of RULES) {
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// skip comments
			const trimmed = line.trimStart();
			if (
				trimmed.startsWith("//") ||
				trimmed.startsWith("*") ||
				trimmed.startsWith("/*")
			)
				continue;

			for (const match of line.matchAll(rule.pattern)) {
				violations.push({
					file: normalized,
					line: i + 1,
					match: match[0],
					rule: rule.name,
					message: rule.message,
				});
			}
		}
	}
}

if (violations.length > 0) {
	console.error("\n🚫 Hardcoded color violations found in admin files:\n");
	for (const v of violations) {
		console.error(`  ${v.file}:${v.line}  ${v.match}`);
		console.error(`    → ${v.message}`);
	}
	console.error(
		`\n${violations.length} violation(s) found. Use theme CSS variables instead.\n`,
	);
	process.exit(1);
} else {
	console.log("✅ No hardcoded color violations found.");
}
