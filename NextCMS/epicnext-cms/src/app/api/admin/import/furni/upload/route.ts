import { invalidateCatalogTotals } from "@/features/catalog/server/catalog-totals";
import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { uploadSingleFurni } from "@/lib/services/upload-import";

export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT, maxBodyBytes: 52 * 1024 * 1024 },
	async (request, ctx) => {
		const formData = await request.formData();

		const classname = (formData.get("classname") as string)?.trim();
		const name = (formData.get("name") as string)?.trim();
		const description = (formData.get("description") as string)?.trim() || "";
		const itemType = formData.get("itemType") as string;
		const xdim = formData.get("xdim")
			? Number(formData.get("xdim"))
			: undefined;
		const ydim = formData.get("ydim")
			? Number(formData.get("ydim"))
			: undefined;
		const canstandon = formData.get("canstandon") === "true";
		const cansiton = formData.get("cansiton") === "true";
		const canlayon = formData.get("canlayon") === "true";
		const interactionType =
			(formData.get("interactionType") as string)?.trim() || "default";
		const customparams = (formData.get("customparams") as string)?.trim() || "";
		const generateSql = formData.get("generateSql") === "true";
		const nitroFile =
			(formData.get("nitro") as File | null) ??
			(formData.get("hab") as File | null);
		const iconFile = formData.get("icon") as File | null;

		if (!classname) return apiError("classname is required", 400);
		if (!name) return apiError("name is required", 400);
		if (!itemType || !["s", "i"].includes(itemType))
			return apiError("itemType must be 's' or 'i'", 400);
		if (!nitroFile || nitroFile.size === 0)
			return apiError(".hab file is required", 400);

		if (nitroFile.size > 50 * 1024 * 1024)
			return apiError(".hab file too large (max 50MB)", 400);

		const nitroBuffer = Buffer.from(await nitroFile.arrayBuffer());

		let iconBuffer: Buffer | null = null;
		if (iconFile && iconFile.size > 0) {
			if (iconFile.size > 2 * 1024 * 1024)
				return apiError("Icon file too large (max 2MB)", 400);
			iconBuffer = Buffer.from(await iconFile.arrayBuffer());
		}

		const result = await uploadSingleFurni({
			classname,
			name,
			description,
			itemType: itemType as "s" | "i",
			xdim,
			ydim,
			canstandon,
			cansiton,
			canlayon,
			interactionType,
			customparams,
			nitroBuffer,
			iconBuffer,
			generateSql,
		});

		if (!result.ok) {
			return apiError(result.error || "Upload failed", 400);
		}

		// The upload can add an offer and its category page.
		invalidateCatalogTotals();

		logAudit({
			userId: ctx.session.user.id,
			action: "furni_upload",
			target: "FurniAsset",
			targetId: result.itemId ?? 0,
			after: {
				classname: result.classname,
				itemId: result.itemId,
				catalogItemId: result.catalogItemId,
			},
		});

		return apiOk({
			itemId: result.itemId,
			catalogItemId: result.catalogItemId,
			classname: result.classname,
			warnings: result.warnings,
			sqlFile: result.sqlFile,
		});
	},
);
