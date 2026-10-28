import { describe, expect, it } from "vitest";
import { PERMS } from "@/lib/permission-slugs";
import { contentMigrationEntries } from "./content";
import { ownedLegacyPages } from "./discover-legacy-pages";
import { validateMigrationEntries } from "./validate-matrix";

const CONTENT_PREFIXES = [
	"/admin/articles",
	"/admin/photos",
	"/admin/media",
	"/admin/banners",
	"/admin/ads",
	"/admin/events",
	"/admin/polls",
	"/admin/help-questions",
	"/admin/tags",
	"/admin/prefixes",
	"/admin/writeable-boxes",
	"/admin/email-templates",
	"/admin/theme",
	"/admin/theme-builder",
	"/admin/favicon",
	"/admin/translations",
] as const;

describe("contentMigrationEntries", () => {
	it("covers every content page without legacy-domain targets", () => {
		const expected = ownedLegacyPages(CONTENT_PREFIXES);
		expect(validateMigrationEntries(expected, contentMigrationEntries)).toEqual(
			[],
		);
		expect(
			contentMigrationEntries.every(
				(row) =>
					row.targetPath === null ||
					row.targetPath.startsWith("/admin/content/"),
			),
		).toBe(true);
	});

	it("preserves dynamic ids in the consolidated workflow targets", () => {
		expect(
			contentMigrationEntries
				.filter((row) => row.legacyPath.endsWith(":id"))
				.map(({ legacyPath, targetPath }) => ({ legacyPath, targetPath })),
		).toEqual([
			{
				legacyPath: "/admin/articles/:id",
				targetPath: "/admin/content/editorial/articles/:id",
			},
			{
				legacyPath: "/admin/ads/:id",
				targetPath: "/admin/content/media/ads/:id",
			},
			{
				legacyPath: "/admin/events/:id",
				targetPath: "/admin/content/engagement/events/:id",
			},
			{
				legacyPath: "/admin/polls/:id",
				targetPath: "/admin/content/engagement/polls/:id",
			},
			{
				legacyPath: "/admin/help-questions/:id",
				targetPath: "/admin/content/help/questions/:id",
			},
		]);
	});

	it("keeps every audited workflow planned without parity claims", () => {
		expect(
			contentMigrationEntries.every(
				(row) => row.status === "PLANNED" && row.parityEvidence.length === 0,
			),
		).toBe(true);
	});

	it("requires privileged settings edits for global runtime configuration", () => {
		for (const legacyPath of [
			"/admin/theme",
			"/admin/favicon",
			"/admin/translations/cms",
			"/admin/translations/client",
			"/admin/translations/emulator",
		]) {
			expect(contentMigrationEntries).toContainEqual(
				expect.objectContaining({
					legacyPath,
					capabilities: expect.objectContaining({
						mutate: [PERMS.SETTINGS_EDIT],
					}),
					auditRequirement: "PRIVILEGED_MUTATION",
				}),
			);
		}
	});
});
