"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, WebsiteTicketTemplate } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { adminAction } from "@/lib/safe-action";
import { ActionError, actionOk } from "@/lib/safe-action-shared";

const templateSchema = z.object({
	title: z.string().min(1).max(255),
	content: z.string().min(1),
	category: z.string().max(50).optional().default("general"),
	sortOrder: z.coerce.number().int().min(0).default(0),
});

export const createTemplate = adminAction(
	{ permission: PERMS.TICKETS_EDIT, schema: templateSchema },
	async (ctx) => {
		const [result] = await db.insert(WebsiteTicketTemplate).values(ctx.data);
		return actionOk({ id: Number(result.insertId) });
	},
);

const updateTemplateInput = templateSchema
	.partial()
	.extend({ id: z.coerce.number().int().positive() });

export const updateTemplate = adminAction(
	{ permission: PERMS.TICKETS_EDIT, schema: updateTemplateInput },
	async (ctx) => {
		const { id, ...data } = ctx.data;
		const [existing] = await db
			.select({ id: WebsiteTicketTemplate.id })
			.from(WebsiteTicketTemplate)
			.where(eq(WebsiteTicketTemplate.id, id))
			.limit(1);
		if (!existing) throw new ActionError("Template not found");
		await db
			.update(WebsiteTicketTemplate)
			.set(data)
			.where(eq(WebsiteTicketTemplate.id, id));
		return actionOk({ id });
	},
);

const deleteTemplateInput = z.object({
	id: z.coerce.number().int().positive(),
});

export const deleteTemplate = adminAction(
	{ permission: PERMS.TICKETS_EDIT, schema: deleteTemplateInput },
	async (ctx) => {
		await db
			.delete(WebsiteTicketTemplate)
			.where(eq(WebsiteTicketTemplate.id, ctx.data.id));
		return actionOk();
	},
);
