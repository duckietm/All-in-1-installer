import { asc, eq, ne } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { ContentCard } from "@/components/public/ui";
import { SanitizedHtml } from "@/components/shared/sanitized-html";
import { db, WebsiteHelpCenterCategories } from "@/lib/db";
import { resolveHotelName } from "@/lib/hotel-name";
import { publicAssetExists } from "@/lib/public-asset";

// Asset path matches AtomCMS's Blade view: asset('/assets/images/help-center/<image_url>').
const HELP_IMAGE_BASE = "/assets/images/help-center";

type HelpCategory = {
	id: bigint;
	name: string;
	content: string;
	position: number;
	imageUrl: string | null;
	buttonText: string | null;
	buttonUrl: string | null;
	buttonColor: string;
	buttonBorderColor: string;
	smallBox: boolean;
};

type HelpCategoryLink = {
	id: bigint;
	name: string;
	position: number;
};

// Faithful to AtomCMS: name / content / button_text carry a `:hotel` placeholder
// replaced with the configured hotel name before display.
function withHotel(text: string | null | undefined, hotelName: string): string {
	return (text ?? "").split(":hotel").join(hotelName);
}

export default async function HelpCategoryPage({
	params,
}: {
	params: Promise<{ category: string }>;
}) {
	const t = await getTranslations("pages.helpCategory");
	const { category } = await params;

	let categoryId: bigint;
	try {
		categoryId = BigInt(category);
	} catch {
		notFound();
	}

	let cat: HelpCategory | null = null;
	try {
		const [row] = await db
			.select({
				id: WebsiteHelpCenterCategories.id,
				name: WebsiteHelpCenterCategories.name,
				content: WebsiteHelpCenterCategories.content,
				position: WebsiteHelpCenterCategories.position,
				imageUrl: WebsiteHelpCenterCategories.imageUrl,
				buttonText: WebsiteHelpCenterCategories.buttonText,
				buttonUrl: WebsiteHelpCenterCategories.buttonUrl,
				buttonColor: WebsiteHelpCenterCategories.buttonColor,
				buttonBorderColor: WebsiteHelpCenterCategories.buttonBorderColor,
				smallBox: WebsiteHelpCenterCategories.smallBox,
			})
			.from(WebsiteHelpCenterCategories)
			.where(eq(WebsiteHelpCenterCategories.id, categoryId))
			.limit(1);
		cat = row ?? null;
	} catch {
		cat = null;
	}

	if (!cat) notFound();

	const hotelName = await resolveHotelName();

	// Sibling help topics, so the reader can jump between categories. Isolated
	// query: a DB hiccup degrades this list to empty rather than 500-ing.
	let siblings: HelpCategoryLink[] = [];
	try {
		siblings = await db
			.select({
				id: WebsiteHelpCenterCategories.id,
				name: WebsiteHelpCenterCategories.name,
				position: WebsiteHelpCenterCategories.position,
			})
			.from(WebsiteHelpCenterCategories)
			.where(ne(WebsiteHelpCenterCategories.id, categoryId))
			.orderBy(asc(WebsiteHelpCenterCategories.position))
			.limit(50);
	} catch {
		siblings = [];
	}

	const title = withHotel(cat.name, hotelName);
	const content = withHotel(cat.content, hotelName);
	const buttonText = withHotel(cat.buttonText, hotelName);
	const imageSrc =
		cat.imageUrl && publicAssetExists(`${HELP_IMAGE_BASE}/${cat.imageUrl}`)
			? `${HELP_IMAGE_BASE}/${cat.imageUrl}`
			: "";
	const hasButton = Boolean(cat.buttonText && cat.buttonText.trim() !== "");

	return (
		<section className="page-grid">
			<p style={{ margin: 0 }}>
				<Link href="/help">{t("back")}</Link>
			</p>

			<ContentCard icon="❓" title={title} subtitle={t("topicSubtitle")}>
				{imageSrc ? (
					<img
						src={imageSrc}
						alt=""
						style={{
							float: "right",
							maxWidth: 160,
							height: "auto",
							margin: "0 0 0.75rem 1rem",
						}}
					/>
				) : null}

				{/* content is author-supplied HTML — sanitised server-side. */}
				<SanitizedHtml html={content} style={{ lineHeight: 1.7 }} />

				{hasButton ? (
					<div style={{ clear: "both", marginTop: "1rem" }}>
						<a
							href={cat.buttonUrl ?? "#"}
							className="btn"
							style={{
								backgroundColor: cat.buttonColor,
								border: `2px solid ${cat.buttonBorderColor}`,
							}}
						>
							{buttonText}
						</a>
					</div>
				) : null}
			</ContentCard>

			{siblings.length > 0 ? (
				<ContentCard
					icon="🧭"
					title={t("moreTitle")}
					subtitle={t("moreSubtitle")}
				>
					<div className="card-grid sm-2 lg-3">
						{siblings.map((s) => (
							<Link
								key={String(s.id)}
								href={`/help/${String(s.id)}`}
								className="card hover"
								style={{ display: "block", color: "inherit" }}
							>
								<strong>{withHotel(s.name, hotelName)}</strong>
							</Link>
						))}
					</div>
				</ContentCard>
			) : null}
		</section>
	);
}
