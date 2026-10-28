import {
	adminAction as foundationAdmin,
	authAction as foundationAuth,
} from "@/lib/foundation/action";
import type { ActionResult } from "@/lib/safe-action-shared";

export type { ActionResult };

export const adminAction = foundationAdmin;
export const authAction = foundationAuth;
