// @ts-nocheck
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

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
		message: "Use theme overlay vars (e.g. bg-foreground/50)",
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

function sourceFiles(directory: string): string[] {
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

describe("no hardcoded colors in CMS source", () => {
	it("flags all hardcoded color utilities across the codebase", () => {
		const violations: string[] = [];
		for (const root of ROOTS) {
			for (const file of sourceFiles(root)) {
				const normalized = relative(process.cwd(), file).replaceAll("\\", "/");
				if (ALLOWLIST.has(normalized)) continue;
				const source = readFileSync(file, "utf8");
				const lines = source.split("\n");

				for (const rule of RULES) {
					for (let i = 0; i < lines.length; i++) {
						const line = lines[i];
						const trimmed = line.trimStart();
						if (
							trimmed.startsWith("//") ||
							trimmed.startsWith("*") ||
							trimmed.startsWith("/*")
						)
							continue;

						for (const match of line.matchAll(rule.pattern)) {
							violations.push(
								`${normalized}:${i + 1} ${match[0]} — ${rule.message}`,
							);
						}
					}
				}
			}
		}
		expect(violations).toEqual([]);
	});
});
