import type { LegacyPage, MigrationEntry } from "./types";

const prohibitedPlaceholder = /\b(?:TBD|TODO|FIXME|UNCLASSIFIED)\b/i;

function hasProhibitedPlaceholder(value: unknown): boolean {
	if (typeof value === "string") return prohibitedPlaceholder.test(value);
	if (Array.isArray(value)) return value.some(hasProhibitedPlaceholder);
	if (value && typeof value === "object")
		return Object.values(value).some(hasProhibitedPlaceholder);

	return false;
}

export function validateMigrationEntries(
	discovered: readonly LegacyPage[],
	entries: readonly MigrationEntry[],
): string[] {
	const issues = new Set<string>();
	const discoveredByPath = new Map<string, LegacyPage[]>();
	for (const page of discovered) {
		const matchingPages = discoveredByPath.get(page.legacyPath) ?? [];
		matchingPages.push(page);
		discoveredByPath.set(page.legacyPath, matchingPages);
	}

	const entriesByPath = new Map<string, MigrationEntry[]>();

	for (const entry of entries) {
		const matchingEntries = entriesByPath.get(entry.legacyPath) ?? [];
		matchingEntries.push(entry);
		entriesByPath.set(entry.legacyPath, matchingEntries);

		const matchingPages = discoveredByPath.get(entry.legacyPath);
		if (!matchingPages) {
			issues.add(`unknown legacyPath: ${entry.legacyPath}`);
			continue;
		}

		const surfaceMatch = matchingPages.find(
			(page) => page.surface === entry.surface,
		);
		const identityMatch = matchingPages.some(
			(page) =>
				page.surface === entry.surface && page.sourceFile === entry.sourceFile,
		);
		if (!surfaceMatch) {
			const expectedSurface = matchingPages
				.map((page) => page.surface)
				.join(" or ");
			issues.add(
				`surface mismatch for legacyPath ${entry.legacyPath}: expected ${expectedSurface}, received ${entry.surface}`,
			);
		} else if (!identityMatch) {
			issues.add(
				`sourceFile mismatch for legacyPath ${entry.legacyPath}: expected ${surfaceMatch.sourceFile}, received ${entry.sourceFile}`,
			);
		}
	}

	for (const page of discovered) {
		const matchingEntries = entriesByPath.get(page.legacyPath) ?? [];

		if (matchingEntries.length === 0) {
			issues.add(`missing legacyPath: ${page.legacyPath}`);
			continue;
		}

		if (matchingEntries.length > 1) {
			issues.add(`duplicate legacyPath: ${page.legacyPath}`);
		}
	}

	for (const entry of entries) {
		const { legacyPath } = entry;

		if (entry.decision === "REMOVE" && entry.targetPath !== null) {
			issues.add(`REMOVE requires null targetPath: ${legacyPath}`);
		}

		if (entry.targetPath === null && entry.decision !== "REMOVE") {
			issues.add(`${entry.decision} requires targetPath: ${legacyPath}`);
		}

		if (
			entry.targetPath !== null &&
			entry.decision !== "REMOVE" &&
			!entry.targetPath.startsWith("/admin/")
		) {
			issues.add(
				`non-REMOVE targetPath must start with /admin/: ${legacyPath}`,
			);
		}

		if (
			(entry.decision === "MERGE" || entry.decision === "REBUILD") &&
			entry.requiredTests.length === 0
		) {
			issues.add(`${entry.decision} requires requiredTests: ${legacyPath}`);
		}

		if (entry.dependencies.mutations.length > 0) {
			if (entry.capabilities.mutate.length === 0) {
				issues.add(
					`mutation dependencies require mutate capabilities: ${legacyPath}`,
				);
			}

			if (entry.auditRequirement === "NONE") {
				issues.add(
					`mutation dependencies require auditRequirement: ${legacyPath}`,
				);
			}
		}

		if (entry.status === "VERIFIED" && entry.parityEvidence.length === 0) {
			issues.add(`VERIFIED requires parityEvidence: ${legacyPath}`);
		}

		if (hasProhibitedPlaceholder(entry)) {
			issues.add(`prohibited placeholder: ${legacyPath}`);
		}
	}

	return [...issues].sort((a, b) => a.localeCompare(b));
}
