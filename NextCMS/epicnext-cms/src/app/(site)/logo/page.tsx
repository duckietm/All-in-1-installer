import LogoGenerator from "@/components/public/logo-generator";
import { ContentCard } from "@/components/public/ui";
import { resolveHotelName } from "@/lib/hotel-name";
import { canAccess, getApiAdminContext, PERMS } from "@/lib/permissions";

export const metadata = { title: "Logo generator" };

/**
 * Public logo generator (AtomCMS logo-generator.blade). Server wrapper that
 * renders the atom-styled ContentCard header and hands off to the fully
 * client-side <LogoGenerator>, which does all styling, live preview, and PNG
 * export in the browser. Saving the site logo requires settings edit access.
 */
export default async function LogoPage() {
	const [initialText, context] = await Promise.all([
		resolveHotelName(),
		getApiAdminContext(),
	]);
	const canSaveToSite = Boolean(
		context &&
			canAccess(
				context.permissions,
				PERMS.ADMIN_DASHBOARD,
				context.session.user.rank,
			) &&
			canAccess(
				context.permissions,
				PERMS.SETTINGS_EDIT,
				context.session.user.rank,
			),
	);
	return (
		<section
			style={{
				display: "grid",
				gap: "1.5rem",
				maxWidth: 920,
				margin: "0 auto",
			}}
		>
			<ContentCard
				icon="🎨"
				title="Logo generator"
				subtitle="Design a logo for your hotel — pick a font, colours and size, then download it as a PNG."
			/>

			<LogoGenerator initialText={initialText} canSaveToSite={canSaveToSite} />
		</section>
	);
}
