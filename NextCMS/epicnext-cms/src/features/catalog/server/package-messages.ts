import "server-only";
import { getTranslations } from "next-intl/server";

const messages: Record<string, string> = {
	"Source categories or offers changed since this package was created. Create a fresh package to include the current data.":
		"sourceChanged",
	"Package changed. Reload it before saving": "saveConflict",
	"Package changed. Refresh the publication preview": "publishConflict",
	"Catalog changed. Refresh the publication preview": "catalogChanged",
	"Catalog package not found": "missing",
	"A package supports at most 200 categories including descendants":
		"pageLimit",
	"A package supports at most 500 offers": "offerLimit",
	"Package data exceeds 8 MB safety limit": "payloadLimit",
	"Package membership cannot change": "membership",
	"Package hierarchy cannot change": "hierarchy",
	"Package furniture references cannot change": "references",
	"Package furniture reference no longer exists": "furnitureMissing",
	"Package published, but audit logging failed.": "auditWarning",
	"Package published, but the hotel update was not delivered.": "hotelWarning",
	"Package published, but export scheduling failed.": "exportWarning",
	"Package published. Refresh the page to see the latest catalog.":
		"refreshWarning",
};
export async function packageMessage(message: string): Promise<string> {
	const key = messages[message];
	if (!key) return message;
	const t = await getTranslations("pages.admin.catalogPackages.backend");
	return t(key);
}
