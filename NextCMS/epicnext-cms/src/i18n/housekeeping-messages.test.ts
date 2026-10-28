import { createTranslator } from "next-intl";
import { expect, it } from "vitest";
import { ADMIN_NAV_GROUPS } from "@/lib/admin-nav";
import { visibleAdminNavigation } from "@/lib/admin-navigation";
import en from "@/messages/en.json";
import itMessages from "@/messages/it.json";

function leafKeys(messages: Record<string, unknown>, prefix = ""): string[] {
	return Object.entries(messages).flatMap(([key, value]) => {
		const path = prefix ? `${prefix}.${key}` : key;
		return typeof value === "string"
			? [path]
			: value && typeof value === "object"
				? leafKeys(value as Record<string, unknown>, path)
				: [];
	});
}

it.each([
	["en", en],
	["it", itMessages],
] as const)(
	"renders housekeeping navigation and shared controls in %s",
	(locale, messages) => {
		const errors: unknown[] = [];
		const t = createTranslator({
			locale,
			messages: messages as unknown as Record<string, string>,
			onError: (error) => errors.push(error),
		});
		const translate = t as unknown as (
			key: string,
			values?: Record<string, string | number>,
		) => string;
		const keys = new Set([
			...ADMIN_NAV_GROUPS.flatMap((g) => [
				g.labelKey,
				...g.items.map((i) => i.labelKey),
			]),
			...visibleAdminNavigation({
				allowedPermissions: [],
				isSuperAdmin: true,
				navConfig: {},
			}).map((g) => g.labelKey),
		]);
		for (const key of keys) translate(`pages.admin.nav.${key}`);
		for (const area of ["actions", "table", "cmsErrors", "workQueue"] as const)
			for (const key of leafKeys(en.pages.admin[area]))
				translate(`pages.admin.${area}.${key}`, {
					count: 2,
					action: "Save",
					page: 2,
					last: 7,
					id: "1",
					name: "Name",
					groups: 1,
				});
		expect(errors).toEqual([]);
	},
);
