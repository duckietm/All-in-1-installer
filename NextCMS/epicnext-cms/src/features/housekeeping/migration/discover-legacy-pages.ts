import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { LegacyPage, LegacySurface } from "./types";

const pageFileName = "page.tsx";

function toLegacyPath(
	surface: LegacySurface,
	segments: readonly string[],
): string {
	const routeSegments = segments
		.filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
		.map((segment) =>
			segment.replace(/^\[\.\.\.(.+)\]$/, ":$1*").replace(/^\[(.+)\]$/, ":$1"),
		);

	return `/${[surface, ...routeSegments].join("/")}`;
}

function discoverSurface(
	rootDir: string,
	surface: LegacySurface,
): LegacyPage[] {
	const surfaceDirectory = join(rootDir, "src", "app", surface);
	const pages: LegacyPage[] = [];

	function walk(directory: string): void {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const entryPath = join(directory, entry.name);

			if (entry.isDirectory()) {
				walk(entryPath);
				continue;
			}

			if (!entry.isFile() || entry.name !== pageFileName) continue;

			const sourceFile = relative(rootDir, entryPath).replaceAll("\\", "/");
			const routeSegments = relative(surfaceDirectory, directory)
				.split(/[/\\]/)
				.filter((segment) => segment && segment !== ".");
			pages.push({
				surface,
				legacyPath: toLegacyPath(surface, routeSegments),
				sourceFile,
			});
		}
	}

	walk(surfaceDirectory);
	return pages;
}

export function discoverLegacyPages(rootDir = process.cwd()): LegacyPage[] {
	return (["admin", "mod"] as const)
		.flatMap((surface) => discoverSurface(rootDir, surface))
		.sort((a, b) =>
			`${a.surface}:${a.legacyPath}:${a.sourceFile}`.localeCompare(
				`${b.surface}:${b.legacyPath}:${b.sourceFile}`,
			),
		);
}

export function ownedLegacyPages(
	prefixes: readonly string[],
	pages: readonly LegacyPage[] = discoverLegacyPages(),
): LegacyPage[] {
	return pages.filter((page) =>
		prefixes.some(
			(prefix) =>
				page.legacyPath === prefix || page.legacyPath.startsWith(`${prefix}/`),
		),
	);
}
