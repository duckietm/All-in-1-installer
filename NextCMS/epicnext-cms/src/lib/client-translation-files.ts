// Whitelist of Nitro client localization files exposed in
// /admin/translations/client. The registry doubles as a path-traversal guard
// for the saveClientTranslations server action: only `id`s defined here can be
// written to.

export type ClientTranslationFormat = "json5" | "json";

export interface ClientTranslationFile {
	id: string;
	/** Path relative to the project root. */
	relPath: string;
	format: ClientTranslationFormat;
	language: "it" | "en" | "shared";
	readOnly: boolean;
	/**
	 * True when the on-disk file commonly contains comments that the json5
	 * serializer cannot preserve. Used to surface a warning in the UI.
	 */
	hasComments: boolean;
	/** Free-form note shown in the UI (e.g. why a file is read-only). */
	note?: string;
}

export const CLIENT_TRANSLATION_FILES: ClientTranslationFile[] = [
	{
		id: "ui-texts-it",
		relPath: "public/nitro-assets/config/UITexts.json5",
		format: "json5",
		language: "it",
		readOnly: false,
		hasComments: true,
		note: "Override del client (sovrascrive ExternalTexts).",
	},
	{
		id: "ui-texts-en",
		relPath: "public/nitro-assets/config/UITexts_en.json5",
		format: "json5",
		language: "en",
		readOnly: true,
		hasComments: true,
		note: "Riferimento EN — non viene caricato dal client.",
	},
	{
		id: "external-texts",
		relPath: "public/nitro-assets/config/ExternalTexts.json5",
		format: "json5",
		language: "shared",
		readOnly: false,
		hasComments: false,
	},
	{
		id: "external-texts-badges",
		relPath: "public/nitro-assets/config/ExternalTexts_Badges.json5",
		format: "json5",
		language: "shared",
		readOnly: false,
		hasComments: false,
		note: "File grande (~30k voci): usa la ricerca.",
	},
	{
		id: "catalog-texts",
		relPath: "public/nitro-assets/config/CatalogTexts.json5",
		format: "json5",
		language: "shared",
		readOnly: false,
		hasComments: false,
	},
	{
		id: "gamedata-external-texts",
		relPath: "public/nitro-assets/gamedata/ExternalTexts.json",
		format: "json",
		language: "shared",
		readOnly: true,
		hasComments: false,
		note: 'Copia "live" servita al client. Generata dal build, modifiche manuali sovrascritte.',
	},
	{
		id: "badge-texts-en",
		relPath: "public/nitro3/localization/badge-texts-en.json",
		format: "json",
		language: "en",
		readOnly: false,
		hasComments: false,
	},
	{
		id: "badge-texts-it",
		relPath: "public/nitro3/localization/badge-texts-it.json",
		format: "json",
		language: "it",
		readOnly: false,
		hasComments: false,
	},
];

export function getClientTranslationFile(
	id: string,
): ClientTranslationFile | undefined {
	return CLIENT_TRANSLATION_FILES.find((f) => f.id === id);
}
