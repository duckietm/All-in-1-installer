// @ts-nocheck
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCmsTranslation, saveCmsTranslation } from "./cms-translations";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});
async function root() {
	const dir = await mkdtemp(path.join(os.tmpdir(), "cms-translations-test-"));
	directories.push(dir);
	return dir;
}
describe("CMS translation persistence", () => {
	it("reads bundled messages without source files and persists only overrides", async () => {
		const dir = await root();
		const before = await readCmsTranslation("it", dir);
		expect(before.messages["pages.admin.search.users"]).toBe("Utenti");
		await saveCmsTranslation(
			"it",
			before.revision,
			{ "pages.admin.search.users": "Persone" },
			dir,
		);
		expect(
			(await readCmsTranslation("it", dir)).messages[
				"pages.admin.search.users"
			],
		).toBe("Persone");
		expect(
			JSON.parse(await readFile(path.join(dir, "it.json"), "utf8")),
		).toEqual({ "pages.admin.search.users": "Persone" });
	});
	it("rejects stale saves and invalid ICU without overwriting saved text", async () => {
		const dir = await root();
		const before = await readCmsTranslation("it", dir);
		await saveCmsTranslation(
			"it",
			before.revision,
			{ "pages.admin.search.users": "Persone" },
			dir,
		);
		await expect(
			saveCmsTranslation(
				"it",
				before.revision,
				{ "pages.admin.search.users": "Stale" },
				dir,
			),
		).rejects.toThrow("conflict");
		const current = await readCmsTranslation("it", dir);
		await expect(
			saveCmsTranslation(
				"it",
				current.revision,
				{ "pages.admin.dashboard.totalAccounts": "{broken" },
				dir,
			),
		).rejects.toThrow("invalid");
		await expect(
			saveCmsTranslation(
				"it",
				current.revision,
				{ "pages.admin.dashboard.totalAccounts": "No variable" },
				dir,
			),
		).rejects.toThrow("variables");
		expect((await readCmsTranslation("it", dir)).revision).toBe(
			current.revision,
		);
	});
	it("restores the bundled value when an override is reset", async () => {
		const dir = await root();
		const before = await readCmsTranslation("it", dir);
		const saved = await saveCmsTranslation(
			"it",
			before.revision,
			{ "pages.admin.search.users": "Persone" },
			dir,
		);
		const reset = await saveCmsTranslation(
			"it",
			saved.revision,
			{ "pages.admin.search.users": null },
			dir,
		);
		expect(reset.messages["pages.admin.search.users"]).toBe("Utenti");
	});
	it("rejects unknown message keys and does not mutate prototypes", async () => {
		const dir = await root();
		const before = await readCmsTranslation("it", dir);
		await expect(
			saveCmsTranslation(
				"it",
				before.revision,
				{ "__proto__.polluted": "yes" },
				dir,
			),
		).rejects.toThrow("unknownKey");
		expect(Object.prototype).not.toHaveProperty("polluted");
	});
});
