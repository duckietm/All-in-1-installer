import { getTranslations } from "next-intl/server";
import { CmsInfoPopup } from "@/components/cms-info-popup";
import { resolveHotelName } from "@/lib/hotel-name";

export async function SiteFooter() {
	const hotelName = await resolveHotelName();
	const year = new Date().getFullYear();
	const t = await getTranslations("footer");

	return (
		<footer
			className="mt-auto flex min-h-14 w-full flex-col items-center justify-center gap-1 px-3 py-3 text-xs sm:text-sm md:flex-row md:gap-3 md:px-8"
			style={{
				backgroundColor: "var(--color-surface)",
				color: "var(--color-text-muted-readable, var(--color-text-muted))",
				borderTop:
					"1px solid color-mix(in srgb, var(--color-text-muted) 8%, transparent)",
			}}
		>
			<div className="md:font-semibold text-[11px] sm:text-[12px] md:text-[14px]">
				{t("copyright", { year, hotel: hotelName })}
			</div>
			<CmsInfoPopup />
		</footer>
	);
}
