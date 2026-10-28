import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { enqueueFurnitureSync } from "@/lib/services/furni-sync-queue";
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	(request, ctx) => enqueueFurnitureSync(request, ctx.session.user.id, "clone"),
);
