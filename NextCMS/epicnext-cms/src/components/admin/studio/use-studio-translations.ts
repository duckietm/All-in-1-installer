"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { setFurnidataTranslateEnabled } from "@/actions/import-furni";
import { adminFetch } from "@/lib/admin-fetch";

// Language codes that get a FurnitureData_<lang>.json file. Mirrors
// FURNIDATA_LANGUAGES in furni-data-i18n (kept client-safe here so we don't pull
// server-only fs modules into the browser bundle).
const TRANSLATE_LANGS = [
	"nl",
	"en",
	"de",
	"fr",
	"es",
	"tr",
	"it",
	"pt",
	"fi",
	"pl",
	"ru",
	"ar",
	"ja",
] as const;

export function useStudioTranslations(defaultTranslate: boolean) {
	const t = useTranslations("admin.studio");
	// Translation controls (per-import toggle + language selection, plus a global
	// default that persists to the site setting and seeds the per-import toggle).
	const ALL_LANGS = TRANSLATE_LANGS as readonly string[];
	const [translate, setTranslate] = useState<boolean>(defaultTranslate);
	const [translateLangs, setTranslateLangs] = useState<string[]>([
		...ALL_LANGS,
	]);
	const [langPickerOpen, setLangPickerOpen] = useState(false);
	const [buildingLanguages, setBuildingLanguages] = useState(false);
	const [globalTranslate, setGlobalTranslate] =
		useState<boolean>(defaultTranslate);

	// Build every language for the whole catalog at once (used to translate
	// everything after importing with translation disabled for speed).
	const buildAllLanguages = async () => {
		setBuildingLanguages(true);
		try {
			const res = await adminFetch(
				"/cms_api/admin/import/furni?action=build-languages",
			);
			const data = (await res.json()) as {
				languages?: Array<{ lang: string; ok: boolean }>;
				error?: string;
			};
			if (res.ok) {
				const langs = data.languages ?? [];
				const okCount = langs.filter((l) => l.ok).length;
				toast.success(
					t("toasts.languagesTranslated", {
						ok: okCount,
						total: langs.length,
					}),
				);
			} else {
				toast.error(data.error ?? t("toasts.translationFailed"));
			}
		} catch {
			toast.error(t("toasts.networkTranslating"));
		} finally {
			setBuildingLanguages(false);
		}
	};

	const toggleLang = (lang: string) =>
		setTranslateLangs((prev) =>
			prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang],
		);

	const onGlobalTranslateChange = async (next: boolean) => {
		setGlobalTranslate(next);
		setTranslate(next);
		try {
			await setFurnidataTranslateEnabled({ enabled: next });
		} catch {
			toast.error(t("toasts.saveDefaultFailed"));
		}
	};

	return {
		ALL_LANGS,
		translate,
		setTranslate,
		translateLangs,
		setTranslateLangs,
		langPickerOpen,
		setLangPickerOpen,
		buildingLanguages,
		globalTranslate,
		buildAllLanguages,
		toggleLang,
		onGlobalTranslateChange,
	};
}
