import { readdir, readFile } from "node:fs/promises";
import { parse } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import { flattenObject } from "@/lib/translations-utils";

describe("CMS message catalogs", () => {
	it("contains valid ICU messages in every shipped locale", async () => {
		const errors: string[] = [];
		for (const file of await readdir("src/messages")) {
			if (!file.endsWith(".json")) continue;
			const messages = flattenObject(
				JSON.parse(await readFile(`src/messages/${file}`, "utf8")),
			);
			for (const [key, value] of Object.entries(messages)) {
				try {
					parse(value);
				} catch {
					errors.push(`${file}: ${key}`);
				}
			}
		}
		expect(errors).toEqual([]);
	});
	it("provides actual text for the search result headings and dashboard counts", async () => {
		const { createTranslator } = await import("next-intl");
		const messages = JSON.parse(await readFile("src/messages/en.json", "utf8"));
		const errors: unknown[] = [];
		const t = createTranslator({
			locale: "en",
			messages,
			onError: (error) => errors.push(error),
		});
		expect(t("pages.admin.dashboard.totalAccounts", { count: 12 })).toContain(
			"12",
		);
		expect(t("pages.admin.search.noResults")).not.toContain("pages.");
		expect(errors).toEqual([]);
	});
});
