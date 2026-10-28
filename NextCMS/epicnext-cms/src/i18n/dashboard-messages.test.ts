import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { expect, it } from "vitest";
import en from "@/messages/en.json";
import italian from "@/messages/it.json";

it.each([
	["en", en],
	["it", italian],
] as const)("renders all dashboard messages in %s", (locale, messages) => {
	const errors: unknown[] = [];
	const t = createTranslator({
		locale,
		messages: messages as typeof en,
		namespace: "pages.myDashboard",
		onError: (error) => errors.push(error),
	});
	const keys = new Set(
		["credits", "duckets", "diamonds", "points"].map(
			(key) => `currencies.${key}`,
		),
	);
	for (const error of [
		"not_enough",
		"no_referrals",
		"bad_config",
		"ratelimit",
		"error",
	])
		keys.add(`errors.${error}`);
	for (const file of ["page.tsx", "CopyReferralButton.tsx"]) {
		for (const match of readFileSync(
			`src/app/(site)/me/${file}`,
			"utf8",
		).matchAll(/\bt\("([^"]+)"/g))
			keys.add(match[1]);
	}
	for (const key of keys) {
		const message = key as Parameters<typeof t>[0];
		expect(t.has(message), key).toBe(true);
		expect(
			t(message, {
				count: 3,
				amount: "30",
				currency: "Diamanti",
				hotel: "Epicnabbo",
				date: "06/09/2026",
			}),
			key,
		).not.toBe("");
	}
	expect(errors).toEqual([]);
});
