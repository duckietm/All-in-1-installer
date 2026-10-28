import { z } from "zod";
import { logAuthorizationEvent } from "@/lib/admin/authorization-events";
import { auth } from "@/lib/auth";
import { canAccess, getApiAdminContext } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/report-error";
import {
	DatabaseError,
	ForbiddenError,
	NotFoundError,
	RateLimitError,
	UnauthorizedError,
	ValidationError,
} from "./errors";
import {
	createStore,
	getRequestId,
	runWithStore,
	setContextUserId,
} from "./request-context";
import { extractClientIpAsync } from "./security";
import type {
	ActionFailure,
	ActionResult,
	ActionSuccess,
	AdminActionContext,
	AppSession,
	IpAddress,
	RequestId,
} from "./types";

function ok<T = Record<string, unknown>>(data?: T): ActionSuccess<T> {
	return { ok: true, data: (data ?? {}) as T } as unknown as ActionSuccess<T>;
}

function fail(
	error: string,
	fieldErrors?: Record<string, string[]>,
): ActionFailure {
	return { ok: false, error, fieldErrors };
}

export { ok as actionOk };

interface AdminOpts<TSchema extends z.ZodType | undefined> {
	/** Single slug, or any-of list (e.g. admin.moderation.edit OR mod.actions). */
	permission?: string | readonly string[];
	schema?: TSchema;
	rateLimitKey?: string;
	rateLimitMax?: number;
	rateLimitWindowMs?: number;
}

type ActionHandler<TSchema extends z.ZodType | undefined> = (
	ctx: AdminActionContext &
		(TSchema extends z.ZodType
			? { data: z.infer<TSchema> }
			: Record<string, never>),
) => Promise<ActionResult>;

export function adminAction<TSchema extends z.ZodType | undefined = undefined>(
	opts: AdminOpts<TSchema>,
	handler: ActionHandler<TSchema>,
) {
	return async (
		input?: TSchema extends z.ZodType ? z.input<TSchema> : undefined,
	): Promise<ActionResult> => {
		const ip = await extractClientIpAsync();
		const store = createStore(ip);

		return runWithStore(store, async () => {
			try {
				const apiCtx = await getApiAdminContext();
				if (!apiCtx) return fail("Unauthorized");

				setContextUserId(Number(apiCtx.session.user.id) as never);

				if (opts.permission) {
					const needed = Array.isArray(opts.permission)
						? opts.permission
						: [opts.permission];
					const allowed = needed.some((slug) =>
						canAccess(apiCtx.permissions, slug, apiCtx.session.user.rank),
					);
					if (!allowed) {
						await logAuthorizationEvent({
							kind: "permission.denied",
							userId: Number(apiCtx.session.user.id),
							username: apiCtx.session.user.name ?? undefined,
							rank: apiCtx.session.user.rank,
							permission: needed.join("|"),
							source: "adminAction",
							reason: "Permission check denied",
						});
						return fail("Unauthorized");
					}
				}

				if (opts.rateLimitKey && opts.rateLimitMax && opts.rateLimitWindowMs) {
					const rlKey = `${opts.rateLimitKey}:${ip}`;
					const result = await rateLimit(
						rlKey,
						opts.rateLimitMax,
						opts.rateLimitWindowMs,
					);
					if (!result.ok)
						return fail(`Rate limited. Retry in ${result.retryAfter}s.`);
				}

				let data: unknown;
				if (opts.schema) {
					const parsed = opts.schema.safeParse(input);
					if (!parsed.success) {
						return fail(
							"Validation failed",
							z.flattenError(parsed.error).fieldErrors as Record<
								string,
								string[]
							>,
						);
					}
					data = parsed.data;
				}

				const ctx = {
					session: apiCtx.session,
					permissions: apiCtx.permissions,
					requestId: getRequestId(),
					ip,
					...(opts.schema
						? { data: data as z.infer<NonNullable<TSchema>> }
						: {}),
				} as AdminActionContext &
					(TSchema extends z.ZodType
						? { data: z.infer<TSchema> }
						: Record<string, never>);

				return await handler(ctx);
			} catch (error) {
				return handleActionError(error);
			}
		});
	};
}

interface AuthOpts<TSchema extends z.ZodType | undefined> {
	schema?: TSchema;
	rateLimitKey?: string;
	rateLimitMax?: number;
	rateLimitWindowMs?: number;
}

export function authAction<TSchema extends z.ZodType | undefined = undefined>(
	opts: AuthOpts<TSchema>,
	handler: (
		ctx: {
			session: AppSession;
			requestId: RequestId;
			ip: IpAddress;
		} & (TSchema extends z.ZodType
			? { data: z.infer<TSchema> }
			: Record<string, never>),
	) => Promise<ActionResult>,
) {
	return async (
		input?: TSchema extends z.ZodType ? z.input<TSchema> : undefined,
	): Promise<ActionResult> => {
		const ip = await extractClientIpAsync();
		const store = createStore(ip);

		return runWithStore(store, async () => {
			try {
				const session = await auth();
				if (!session?.user) return fail("Unauthorized");

				setContextUserId(Number(session.user.id) as never);

				if (opts.rateLimitKey && opts.rateLimitMax && opts.rateLimitWindowMs) {
					const rlKey = `${opts.rateLimitKey}:${ip}`;
					const result = await rateLimit(
						rlKey,
						opts.rateLimitMax,
						opts.rateLimitWindowMs,
					);
					if (!result.ok)
						return fail(`Rate limited. Retry in ${result.retryAfter}s.`);
				}

				let data: unknown;
				if (opts.schema) {
					const parsed = opts.schema.safeParse(input);
					if (!parsed.success) {
						return fail(
							"Validation failed",
							z.flattenError(parsed.error).fieldErrors as Record<
								string,
								string[]
							>,
						);
					}
					data = parsed.data;
				}

				const ctx = {
					session: session as unknown as AppSession,
					requestId: getRequestId(),
					ip,
				} as {
					session: AppSession;
					requestId: RequestId;
					ip: IpAddress;
				} & (TSchema extends z.ZodType
					? { data: z.infer<TSchema> }
					: Record<string, never>);

				if (opts.schema) {
					(ctx as Record<string, unknown>).data = data as z.infer<
						NonNullable<TSchema>
					>;
				}

				return await handler(ctx);
			} catch (error) {
				return handleActionError(error);
			}
		});
	};
}

export function handleActionError(error: unknown): ActionFailure {
	if (error instanceof ValidationError) {
		return fail(error.message, error.fieldErrors);
	}
	if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
		return fail(error.message);
	}
	if (error instanceof NotFoundError) {
		return fail(error.message);
	}
	if (error instanceof RateLimitError) {
		return fail(error.message);
	}
	if (error instanceof DatabaseError) {
		return fail("A database error occurred");
	}
	if (error instanceof Error && error.name === "ActionError") {
		return fail(error.message);
	}
	if (error instanceof Error && error.name === "ZodError") {
		return fail("Validation failed");
	}

	reportError(error, "Action error");
	return fail("Internal server error");
}
