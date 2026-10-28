import { getTranslations } from "next-intl/server";
import { getThemeManagerData } from "@/actions/theme-manager";
import { ThemeManagerPanel } from "@/components/admin/theme/theme-manager-panel";
import { HousekeepingPageShell } from "@/features/housekeeping/foundation/page/housekeeping-page-shell";

const MESSAGE_PREFIX = "pages.housekeeping.domains.hotel.routes.themeManager";

const NOTICES = new Set([
	"saved",
	"applied",
	"renamed",
	"deleted",
	"imported",
	"preset",
	"background",
	"importError",
	"backgroundError",
]);

export default async function HousekeepingHotelThemeManagerPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const t = await getTranslations(MESSAGE_PREFIX);
	const params = await searchParams;
	const first = Array.isArray(params.notice) ? params.notice[0] : params.notice;
	const notice = first && NOTICES.has(first) ? first : undefined;

	const { themes, current, background } = await getThemeManagerData();
	const activeName =
		typeof current.theme_preset === "string" && current.theme_preset
			? current.theme_preset
			: "Atom (golden)";

	return (
		<HousekeepingPageShell title={t("title")} description={t("description")}>
			<ThemeManagerPanel
				themes={themes}
				current={current}
				background={background}
				activeName={activeName}
				notice={notice}
			/>
		</HousekeepingPageShell>
	);
}
