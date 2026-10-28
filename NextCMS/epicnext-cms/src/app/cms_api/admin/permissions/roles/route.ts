import { and, eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { AclModelPermission, AclModelRole, AclRole, db } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

export const POST = withAdmin(
	{ permission: PERMS.PERMISSIONS_MANAGE },
	async (request) => {
		const body = await request.json();
		const slug = String(body.slug ?? "")
			.trim()
			.toLowerCase();
		const title = String(body.title ?? "").trim();
		if (!/^[a-z0-9._-]{2,64}$/.test(slug) || !title)
			return apiError("Valid slug and title required", 400);
		const [result] = await db.insert(AclRole).values({ slug, title });
		const role = { id: Number(result.insertId), slug, title };
		revalidateTag("permissions", { expire: 0 });
		return NextResponse.json({ role });
	},
);

export const DELETE = withAdmin(
	{ permission: PERMS.PERMISSIONS_MANAGE },
	async (request) => {
		const id = Number(request.nextUrl.searchParams.get("id"));
		if (!Number.isInteger(id) || id <= 0)
			return apiError("Valid ID required", 400);
		const [role] = await db
			.select({ slug: AclRole.slug })
			.from(AclRole)
			.where(eq(AclRole.id, id))
			.limit(1);
		if (!role) return apiError("Role not found", 404);
		if (role.slug.startsWith("rank_"))
			return apiError("Rank roles must be managed through emulator ranks", 409);
		await db.transaction(async (tx) => {
			await tx
				.delete(AclModelPermission)
				.where(
					and(
						eq(AclModelPermission.modelType, "Role"),
						eq(AclModelPermission.modelId, id),
					),
				);
			await tx.delete(AclModelRole).where(eq(AclModelRole.roleId, id));
			await tx.delete(AclRole).where(eq(AclRole.id, id));
		});
		revalidateTag("permissions", { expire: 0 });
		return NextResponse.json({ success: true });
	},
);
