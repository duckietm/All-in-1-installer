import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PublicLoadError } from "@/components/public/load-error";
import {
	type LightboxPhoto,
	PhotoLightbox,
} from "@/components/public/photo-lightbox";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { cached } from "@/lib/cache";
import { CameraWeb, db } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { loadProfilePrivacyMap } from "@/lib/services/profile-privacy";
import { publicReadFailure } from "@/lib/services/public-read";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.photos");
	return {
		title: t("title"),
		description: t("subtitle"),
		openGraph: {
			title: t("title"),
			description: t("subtitle"),
			type: "website",
		},
	};
}

type Photo = {
	id: number;
	userId: number;
	roomId: number;
	timestamp: number;
	url: string;
};

export default async function PhotosPage() {
	const t = await getTranslations("pages.photos");

	let photos: Photo[] | null = [];
	try {
		photos = await cached(
			"photos:grid",
			60_000,
			async () =>
				db
					.select()
					.from(CameraWeb)
					.orderBy(desc(CameraWeb.timestamp))
					.limit(48),
			{ staleMs: 120000 },
		);
	} catch (error) {
		photos = publicReadFailure("photos")(error);
	}

	// Users can hide their photos everywhere, not only on their profile.
	const photoOwners = [...new Set((photos ?? []).map((p) => p.userId))];
	const photoPrivacy = await loadProfilePrivacyMap(photoOwners);
	const visiblePhotos = (photos ?? []).filter(
		(p) => photoPrivacy.get(p.userId)?.photos !== false,
	);

	// Pre-shape for the client lightbox: translate captions server-side so the
	// client component stays free of i18n/db dependencies.
	const items: LightboxPhoto[] = visiblePhotos.map((p) => ({
		id: String(p.id),
		url: p.url,
		alt: t("photoAlt", { id: p.userId }),
		date: formatDate(new Date(p.timestamp * 1000)),
		user: t("byUser", { id: p.userId }),
	}));

	return (
		<section className="page-grid">
			<ContentCard icon="📸" title={t("title")} subtitle={t("subtitle")} />

			<ContentCard padded={items.length === 0}>
				{photos === null ? (
					<PublicLoadError href="/photos" />
				) : items.length === 0 ? (
					<EmptyState icon="📸">{t("noPhotos")}</EmptyState>
				) : (
					<PhotoLightbox photos={items} />
				)}
			</ContentCard>
		</section>
	);
}
