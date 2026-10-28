import { redirect } from "next/navigation";

// Default landing for /admin/translations → first tab.
// The shared TranslationsTabs (in layout.tsx) gives access to every section.
export default function TranslationsHubPage() {
	redirect("/admin/translations/cms");
}
