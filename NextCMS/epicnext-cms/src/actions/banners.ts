"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, WebsiteBanner } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { adminAction } from "@/lib/safe-action";
import { ActionError, actionOk } from "@/lib/safe-action-shared";
import { logAudit } from "@/lib/services/audit";

const bannerSchema = z.object({
	title: z.string().min(1).max(255),
	subtitle: z.string().max(500).optional().default(""),
	image: z.string().max(500),
	link: z.string().max(500).optional().default(""),
	color: z.string().max(20).optional().default(""),
	isActive: z.coerce.number().int().min(0).max(1).default(1),
	sortOrder: z.coerce.number().int().min(0).default(0),
	startDate: z.string().max(50).nullable().optional(),
	endDate: z.string().max(50).nullable().optional(),
});

export const createBanner = adminAction(
	{ permission: PERMS.BANNERS_EDIT, schema: bannerSchema },
	async (ctx) => {
		const [result] = await db.insert(WebsiteBanner).values(ctx.data);
		const id = Number(result.insertId);
		logAudit({
			userId: ctx.session.user.id,
			action: "banner_create",
			target: "WebsiteBanner",
			targetId: id,
			after: { title: ctx.data.title },
		});
		return actionOk({ id });
	},
);

const updateBannerInput = bannerSchema
	.partial()
	.extend({ id: z.coerce.number().int().positive() });

export const updateBanner = adminAction(
	{ permission: PERMS.BANNERS_EDIT, schema: updateBannerInput },
	async (ctx) => {
		const { id, ...data } = ctx.data;
		const [existing] = await db
			.select({ id: WebsiteBanner.id })
			.from(WebsiteBanner)
			.where(eq(WebsiteBanner.id, id))
			.limit(1);
		if (!existing) throw new ActionError("Banner not found");
		await db.update(WebsiteBanner).set(data).where(eq(WebsiteBanner.id, id));
		logAudit({
			userId: ctx.session.user.id,
			action: "banner_update",
			target: "WebsiteBanner",
			targetId: id,
		});
		return actionOk({ id });
	},
);

const deleteBannerInput = z.object({ id: z.coerce.number().int().positive() });

export const deleteBanner = adminAction(
	{ permission: PERMS.BANNERS_EDIT, schema: deleteBannerInput },
	async (ctx) => {
		await db.delete(WebsiteBanner).where(eq(WebsiteBanner.id, ctx.data.id));
		logAudit({
			userId: ctx.session.user.id,
			action: "banner_delete",
			target: "WebsiteBanner",
			targetId: ctx.data.id,
		});
		return actionOk();
	},
);
