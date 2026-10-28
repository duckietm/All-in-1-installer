import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import itMessages from "@/messages/it.json";
import { HOUSEKEEPING_MANIFESTS } from "../manifests";

const requiredKeys = [
	"pages.housekeeping.preview.badge",
	"pages.housekeeping.preview.commandDisabled",
	"pages.housekeeping.preview.backToSite",
	"pages.housekeeping.navigation.skipToContent",
	"pages.housekeeping.navigation.primary",
	"pages.housekeeping.navigation.contextual",
	"pages.housekeeping.states.loading.title",
	"pages.housekeeping.states.loading.description",
	"pages.housekeeping.states.empty.title",
	"pages.housekeeping.states.empty.description",
	"pages.housekeeping.states.partial.label",
	"pages.housekeeping.states.partial.title",
	"pages.housekeeping.states.partial.description",
	"pages.housekeeping.states.error.title",
	"pages.housekeeping.states.error.description",
];

const expectedDomainMessages = [
	{
		id: "operations",
		labelKey: "pages.housekeeping.domains.operations.title",
		descriptionKey: "pages.housekeeping.domains.operations.description",
	},
	{
		id: "people",
		labelKey: "pages.housekeeping.domains.people.title",
		descriptionKey: "pages.housekeeping.domains.people.description",
	},
	{
		id: "content",
		labelKey: "pages.housekeeping.domains.content.title",
		descriptionKey: "pages.housekeeping.domains.content.description",
	},
	{
		id: "economy",
		labelKey: "pages.housekeeping.domains.economy.title",
		descriptionKey: "pages.housekeeping.domains.economy.description",
	},
	{
		id: "hotel",
		labelKey: "pages.housekeeping.domains.hotel.title",
		descriptionKey: "pages.housekeeping.domains.hotel.description",
	},
	{
		id: "system",
		labelKey: "pages.housekeeping.domains.system.title",
		descriptionKey: "pages.housekeeping.domains.system.description",
	},
] as const;

function resolveMessage(messages: unknown, key: string): unknown {
	return key.split(".").reduce<unknown>((value, segment) => {
		if (value === null || typeof value !== "object") return undefined;

		return (value as Record<string, unknown>)[segment];
	}, messages);
}

describe("housekeeping localization contract", () => {
	it.each([
		["English", en],
		["Italian", itMessages],
	])("provides the planned housekeeping subtree in %s", (_locale, messages) => {
		const housekeeping = resolveMessage(messages, "pages.housekeeping");

		expect(housekeeping).toEqual(expect.any(Object));
		expect(Object.keys(housekeeping as object)).toEqual([
			"preview",
			"navigation",
			"domains",
			"states",
		]);

		for (const key of requiredKeys) {
			expect(resolveMessage(messages, key), key).toEqual(expect.any(String));
		}

		for (const [index, expected] of expectedDomainMessages.entries()) {
			const manifest = HOUSEKEEPING_MANIFESTS[index];

			expect(manifest).toMatchObject(expected);
			expect(
				resolveMessage(messages, expected.labelKey),
				expected.labelKey,
			).toEqual(expect.any(String));
			expect(
				resolveMessage(messages, expected.descriptionKey),
				expected.descriptionKey,
			).toEqual(expect.any(String));
		}
	});

	it("uses idiomatic Italian copy for the housekeeping shell", () => {
		expect(resolveMessage(itMessages, "pages.housekeeping.preview.badge")).toBe(
			"Anteprima della struttura",
		);
		expect(
			resolveMessage(itMessages, "pages.housekeeping.navigation.primary"),
		).toBe("Aree housekeeping");
		expect(
			resolveMessage(itMessages, "pages.housekeeping.states.loading.title"),
		).toBe("Caricamento in corso");
		expect(
			resolveMessage(
				itMessages,
				"pages.housekeeping.states.loading.description",
			),
		).toBe("Stiamo preparando gli strumenti di housekeeping disponibili.");
	});
});
