import { getTranslations } from "next-intl/server";
import { ContentCard } from "@/components/public/ui";
import { resolveHotelName } from "@/lib/hotel-name";
import { siteSettings } from "@/lib/services/site-settings";

export default async function MaintenancePage() {
	const t = await getTranslations("pages.maintenance");
	const [hotel, message] = await Promise.all([
		resolveHotelName(),
		siteSettings.get(
			"maintenance_message",
			"We are currently performing maintenance. Please check back soon.",
		),
	]);

	return (
		<section style={{ maxWidth: 560, margin: "2rem auto" }}>
			<ContentCard
				icon="🛠️"
				title={t("title", { hotel })}
				subtitle={t("subtitle")}
			>
				<p style={{ marginTop: 0 }}>{message}</p>
				<p className="muted" style={{ marginBottom: 0 }}>
					{t("staffCanLogIn")}
				</p>
			</ContentCard>
		</section>
	);
}
