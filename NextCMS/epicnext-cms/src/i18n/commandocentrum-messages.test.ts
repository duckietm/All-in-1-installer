import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import itMessages from "@/messages/it.json";
import nl from "@/messages/nl.json";
import { mergeMessages } from "./merge-messages";

const namespace = "pages.admin.commandocentrum";
const keys = new Set(
	["page.tsx", "commandocentrum-controls.tsx"].flatMap((file) =>
		Array.from(
			readFileSync(`src/app/admin/commandocentrum/${file}`, "utf8").matchAll(
				/\bt\("([^"]+)"/g,
			),
			(match) => match[1],
		),
	),
);
for (const group of ["hotel", "players", "rewards", "advanced"])
	keys.add(`groups.${group}`);

describe("command center translations", () => {
	it.each([
		["en", en],
		["it", itMessages],
	] as const)("provides every rendered message in %s", (locale, messages) => {
		const errors: unknown[] = [];
		const t = createTranslator({
			locale,
			messages: messages as typeof en,
			namespace,
			onError: (error) => errors.push(error),
		});
		for (const key of keys) {
			expect(t.has(key as Parameters<typeof t>[0]), key).toBe(true);
			expect(
				t(key as Parameters<typeof t>[0], { count: 42, time: "12:34" }),
				key,
			).not.toBe("");
		}
		expect(errors).toEqual([]);
	});
	it("supplies nested fallback messages to a client translator and formats values", () => {
		const messages = mergeMessages(en, nl) as typeof en;
		const t = createTranslator({ locale: "nl", messages, namespace });
		expect(t("title")).toBe(nl.pages.admin.commandocentrum.title);
		expect(t("totalAccounts", { count: 42 })).toBe("42 total accounts");
		expect(t("groups.players")).toBe("Players");
		expect(t("checkedAt", { time: "12:34" })).toBe("Checked at 12:34");
	});
});
