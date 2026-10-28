import { createHash } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { apiError, apiJson, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { getRequestId } from "@/lib/foundation/request-context";
import { validateClassnames } from "@/lib/furni/studio-inspection";
import { PERMS } from "@/lib/permission-slugs";
import { redis } from "@/lib/redis";
import { getSource } from "@/lib/services/clone-sources";
import { readFurnitureAttachment } from "@/lib/services/furni-attachment";
import {
	ImportJobStore,
	ImportRequestConflict,
	validJobId,
} from "@/lib/services/furni-job-store";
import { drainFurnitureImports } from "@/lib/services/furni-job-worker";

const schema = z.object({
	mode: z.literal("repair").optional(),
	id: z.uuid().refine((value) => value[14] === "4"),
	sourceId: z.string().max(100).optional(),
	translate: z.boolean().default(false),
	langs: z
		.array(z.string().regex(/^[a-z]{2,3}$/))
		.max(25)
		.optional(),
	items: z
		.array(
			z.object({
				id: z.number().int().nonnegative(),
				classname: z.string(),
				name: z.string().min(1).max(500),
				description: z.string().max(5000),
				type: z.enum(["flooritem", "wallitem"]),
				revision: z.number().int().nonnegative(),
				category: z.string().max(200),
				attachmentId: z.uuid().optional(),
			}),
		)
		.min(1)
		.max(500),
});
export const GET = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const query = new URL(request.url).searchParams;
		if (query.has("page")) {
			const before = query.get("before") || undefined;
			if (
				before &&
				!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[0-9a-f-]{36}$/i.test(
					before,
				)
			)
				return apiError("Invalid history cursor", 400);
			after(drainFurnitureImports);
			return apiOk(
				await new ImportJobStore().page({
					userId: ctx.session.user.id,
					limit: 20,
					before,
				}),
			);
		}
		after(drainFurnitureImports);
		const jobs = await new ImportJobStore().list({
			userId: ctx.session.user.id,
			limit: 30,
		});
		return apiOk({ jobs });
	},
);
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const parsed = schema.safeParse(await request.json().catch(() => null));
		if (
			!parsed.success ||
			!validateClassnames(parsed.data.items.map((item) => item.classname))
		)
			return apiError(
				"Invalid furniture import request (maximum 500 items)",
				400,
			);
		const store = new ImportJobStore(),
			body = parsed.data;
		const unique = [
			...new Map(body.items.map((item) => [item.classname, item])).values(),
		];
		// Hash validated request fields before worker checkpoints can change the job.
		const { id: _id, ...input } = body;
		const requestFingerprint = createHash("sha256")
			.update(JSON.stringify({ ...input, items: unique }))
			.digest("hex");
		const existing = await store.read(body.id).catch((error) => {
			if (error.code === "ENOENT") return null;
			throw error;
		});
		if (existing) {
			// Legacy jobs have no immutable fingerprint: never infer equivalence from progress.
			if (
				existing.userId !== ctx.session.user.id ||
				existing.requestFingerprint !== requestFingerprint
			)
				return apiError("Request ID already used", 409);
			after(drainFurnitureImports);
			return apiOk({ job: existing });
		}
		if (!redis || (await redis.ping().catch(() => null)) !== "PONG")
			return apiError(
				"Background import queue is temporarily unavailable. Please retry shortly.",
				503,
			);
		if (body.sourceId && !(await getSource(body.sourceId)))
			return apiError("Source not found", 404);
		const createdAt = new Date().toISOString();
		let job: Awaited<ReturnType<ImportJobStore["create"]>>;
		try {
			job = await store.create({
				...body,
				requestFingerprint,
				userId: ctx.session.user.id,
				operationId: getRequestId(),
				createdAt,
				updatedAt: createdAt,
				state: "queued",
				items: unique.map((item) => ({ ...item, state: "pending" })),
			});
		} catch (error) {
			if (error instanceof ImportRequestConflict)
				return apiError("Request ID already used", 409);
			throw error;
		}
		after(drainFurnitureImports);
		return apiOk({ job });
	},
);

export const PATCH = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const body = await request.json().catch(() => null);
		if (!validJobId(body?.id)) return apiError("Invalid import ID", 400);
		if (body.action === "retry") {
			if (!redis || (await redis.ping().catch(() => null)) !== "PONG")
				return apiError(
					"Background import queue is temporarily unavailable",
					503,
				);
			const parsed = z
				.record(z.string(), z.uuid())
				.refine(
					(value) =>
						Object.keys(value).length <= 500 &&
						(!Object.keys(value).length ||
							validateClassnames(Object.keys(value))),
				)
				.safeParse(body.attachments ?? {});
			if (!parsed.success) return apiError("Invalid recovery attachments", 400);
			const attachments = parsed.data;
			let job: Awaited<ReturnType<ImportJobStore["retry"]>>;
			try {
				for (const [classname, attachmentId] of Object.entries(attachments))
					await readFurnitureAttachment(
						attachmentId,
						classname,
						ctx.session.user.id,
					);
				const store = new ImportJobStore();
				job = Object.keys(attachments).length
					? await store.retry(body.id, ctx.session.user.id, attachments)
					: await store.retry(body.id, ctx.session.user.id);
			} catch (error) {
				const message = error instanceof Error ? error.message : "";
				const code = message.startsWith("Recovery already started")
					? "alreadyStarted"
					: message.includes("not eligible")
						? "notEligible"
						: "invalidFile";
				return apiJson(
					{ error: "Cannot resume with these attachments", code },
					{ status: 400 },
				);
			}
			if (!job)
				return apiError(
					"No safe remaining items to retry, or import job not found",
					404,
				);
			after(drainFurnitureImports);
			return apiOk({ job });
		}
		if (body.action && body.action !== "cancel")
			return apiError("Invalid job action", 400);
		const job = await new ImportJobStore().requestCancellation(
			body.id,
			ctx.session.user.id,
		);
		if (!job) return apiError("Import job not found", 404);
		after(drainFurnitureImports);
		return apiOk({ job });
	},
);
