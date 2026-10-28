import { and, eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { AclModelRole, db } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

export const POST = withAdmin(
	{ permission: PERMS.PERMISSIONS_MANAGE },
	async (request) => {
		const body = await request.json();
		const userId = Number(body.userId);
		const roleId = Number(body.roleId);
		if (
			!Number.isInteger(userId) ||
			userId <= 0 ||
			!Number.isInteger(roleId) ||
			roleId <= 0
		) {
			return apiError("Valid userId and roleId required", 400);
		}
		if (body.action === "remove") {
			await db
				.delete(AclModelRole)
				.where(
					and(
						eq(AclModelRole.modelType, "User"),
						eq(AclModelRole.modelId, userId),
						eq(AclModelRole.roleId, roleId),
					),
				);
		} else {
			const [existing] = await db
				.select({ modelId: AclModelRole.modelId })
				.from(AclModelRole)
				.where(
					and(
						eq(AclModelRole.modelType, "User"),
						eq(AclModelRole.modelId, userId),
						eq(AclModelRole.roleId, roleId),
					),
				)
				.limit(1);
			if (!existing)
				await db.insert(AclModelRole).values({
					modelType: "User",
					modelId: userId,
					roleId,
				});
		}
		revalidateTag("permissions", { expire: 0 });
		return NextResponse.json({ success: true });
	},
);
