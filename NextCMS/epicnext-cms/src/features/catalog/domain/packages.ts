import { z } from "zod";
import { CatalogInputError } from "./hierarchy";
import { offerIdSchema, offerInteger, parseFurnitureIds } from "./offer-input";

const flag = z.enum(["0", "1"]);
export const packagePageSchema = z
	.object({
		id: offerIdSchema,
		parentId: offerInteger.min(-1),
		caption: z.string().min(1).max(128),
		enabled: flag,
		visible: flag,
		iconImage: offerInteger,
		minRank: offerInteger,
		clubOnly: flag,
		vipOnly: flag,
		orderNum: offerInteger,
		pageLayout: z.string().min(1).max(26),
	})
	.strict();
export const packageOfferSchema = z
	.object({
		id: offerIdSchema,
		pageId: offerIdSchema,
		catalogName: z.string().max(100),
		clubOnly: flag.optional(),
		itemIds: z
			.string()
			.max(666)
			.refine((value) => {
				try {
					parseFurnitureIds(value);
					return true;
				} catch {
					return false;
				}
			}),
		costCredits: offerInteger,
		costPoints: offerInteger,
		pointsType: offerInteger,
		amount: offerInteger,
	})
	.strict();
export const packageSnapshotSchema = z
	.object({
		pages: z.array(packagePageSchema).min(1).max(200),
		offers: z.array(packageOfferSchema).max(500),
	})
	.strict();
export type PackagePage = z.infer<typeof packagePageSchema>;
export type PackageOffer = z.infer<typeof packageOfferSchema>;
export type PackageSnapshot = z.infer<typeof packageSnapshotSchema>;
export interface CatalogPackage {
	id: string;
	name: string;
	version: number;
	status: "draft" | "published";
	mode: "update" | "copy";
	targetParentId: number;
	baseline: PackageSnapshot;
	draft: PackageSnapshot;
	updatedAt: string;
	publishedAt: string | null;
}
export type PackageListRow = Pick<
	CatalogPackage,
	"id" | "name" | "version" | "status" | "mode" | "updatedAt"
>;
export interface PackagePreview {
	version: number;
	fingerprint: string;
	changedPages: number;
	changedOffers: number;
	conflicts: string[];
}
export interface PackagePublication {
	pageIds: number[];
	offerCount: number;
	alreadyPublished: boolean;
	warnings?: string[];
}
export const packageIdSchema = z.uuid();
export const packageParentSchema = offerInteger.refine(
	(value) => value === -1 || value > 0,
);
export const createPackageSchema = z
	.object({
		name: z.string().trim().min(1).max(128),
		pageIds: z.array(offerIdSchema).min(1).max(200),
		mode: z.enum(["update", "copy"]),
		targetParentId: packageParentSchema,
	})
	.strict();
export type CreateCatalogPackageInput = z.infer<typeof createPackageSchema>;
export const savePackageSchema = z
	.object({
		id: packageIdSchema,
		version: z.number().int().positive(),
		name: z.string().trim().min(1).max(128),
		draft: packageSnapshotSchema,
		targetParentId: packageParentSchema,
	})
	.strict();
export type SaveCatalogPackageInput = z.infer<typeof savePackageSchema>;
export const publishPackageSchema = z
	.object({
		id: packageIdSchema,
		version: z.number().int().positive(),
		fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict();
export type PublishCatalogPackageInput = z.infer<typeof publishPackageSchema>;
/** Editing changes metadata and commercial fields, never package membership or furniture references. */
export function validatePackageDraft(
	baseline: PackageSnapshot,
	value: unknown,
): PackageSnapshot {
	const draft = packageSnapshotSchema.parse(value);
	for (const kind of ["pages", "offers"] as const) {
		if (
			draft[kind].length !== baseline[kind].length ||
			new Set(draft[kind].map((row) => row.id)).size !== draft[kind].length
		)
			throw new CatalogInputError("Package membership cannot change");
	}
	const pages = new Map(baseline.pages.map((page) => [page.id, page]));
	const offers = new Map(baseline.offers.map((offer) => [offer.id, offer]));
	for (const page of draft.pages)
		if (!pages.has(page.id) || pages.get(page.id)?.parentId !== page.parentId)
			throw new CatalogInputError("Package hierarchy cannot change");
	for (const offer of draft.offers) {
		const source = offers.get(offer.id);
		if (
			!source ||
			source.pageId !== offer.pageId ||
			source.itemIds !== offer.itemIds ||
			source.clubOnly !== offer.clubOnly ||
			!pages.has(offer.pageId)
		)
			throw new CatalogInputError("Package furniture references cannot change");
	}
	return {
		pages: [...draft.pages].sort((a, b) => a.id - b.id),
		offers: [...draft.offers].sort((a, b) => a.id - b.id),
	};
}
