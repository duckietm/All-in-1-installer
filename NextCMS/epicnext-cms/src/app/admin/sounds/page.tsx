import { asc, count, gt } from "drizzle-orm";
import { redirect } from "next/navigation";
import { CatalogItems, db, Soundtracks } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";
import {
	DEFAULT_SOUNDTRACK_BASE_URL,
	parseTrackSamples,
} from "@/lib/services/soundtracks";
import { SoundsClient } from "./sounds-client";

export default async function SoundsPage() {
	const { session, permissions } = await getAdminContext();

	if (!canAccess(permissions, PERMS.CATALOG_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const canEdit = canAccess(permissions, PERMS.CATALOG_EDIT, session.user.rank);

	const [rows, usage, baseUrlSetting] = await Promise.all([
		db
			.select({
				id: Soundtracks.id,
				code: Soundtracks.code,
				name: Soundtracks.name,
				author: Soundtracks.author,
				length: Soundtracks.length,
				track: Soundtracks.track,
			})
			.from(Soundtracks)
			.orderBy(asc(Soundtracks.id)),
		db
			.select({
				songId: CatalogItems.songId,
				total: count(),
			})
			.from(CatalogItems)
			.where(gt(CatalogItems.songId, 0))
			.groupBy(CatalogItems.songId),
		siteSettings.get("soundtrack_base_url", DEFAULT_SOUNDTRACK_BASE_URL),
	]);

	const usageMap: Record<number, number> = {};
	for (const row of usage) {
		if (row.songId != null) usageMap[row.songId] = Number(row.total);
	}

	const soundtracks = rows.map((r) => {
		const samples = parseTrackSamples(r.track);
		return {
			id: r.id,
			code: r.code,
			name: r.name,
			author: r.author,
			length: r.length,
			track: r.track,
			samples,
			kind: (samples.length > 0 ? "composition" : "single") as
				| "composition"
				| "single",
			usedBy: usageMap[r.id] ?? 0,
		};
	});

	// Normalize: ensure trailing slash so ${base}${code}.mp3 yields a valid URL.
	const configuredBaseUrl = baseUrlSetting ?? "/sounds/";
	const baseUrl = configuredBaseUrl.endsWith("/")
		? configuredBaseUrl
		: `${configuredBaseUrl}/`;

	return (
		<div className="space-y-6">
			<p className="text-muted-foreground">
				Files are served from <code>{baseUrl}</code> (configurable in{" "}
				<a href="/admin/settings" className="underline">
					Settings
				</a>
				).
			</p>
			<SoundsClient
				soundtracks={soundtracks}
				canEdit={canEdit}
				baseUrl={baseUrl}
			/>
		</div>
	);
}
