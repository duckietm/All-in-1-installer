import { after, type NextRequest, NextResponse } from "next/server";
import { logAuthorizationEvent } from "@/lib/admin/authorization-events";
import {
	createStore,
	runWithStore,
	setContextUserId,
} from "@/lib/foundation/request-context";
import { validateCsrfToken } from "@/lib/foundation/security";
import type { IpAddress, UserId } from "@/lib/foundation/types";
import {
	collectPerformance,
	routeTemplate,
} from "@/lib/performance-diagnostics";
import { recordPerformance } from "@/lib/performance-store";
import { canAccess, getApiAdminContext } from "@/lib/permissions";
import { logServerError } from "@/lib/server-log";

import {
	beginCatalogExport,
	catalogExportEnabled,
	isCatalogMutation,
} from "@/lib/services/catalog-git-queue";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

type AdminContext = NonNullable<Awaited<ReturnType<typeof getApiAdminContext>>>;
// Next 15+ passes `params` as a promise and its generated route types require it
// to be present, so this is deliberately not optional. `routeContext.params` is
// awaited below without a guard, so an optional type would have been a lie
// anyway. A route with no dynamic segments still receives `Promise<{}>`.
type RouteContext = { params: Promise<Record<string, string | string[]>> };
type AdminHandler = (
	request: NextRequest,
	context: AdminContext,
	routeContext: RouteContext,
) => Promise<Response> | Response;

export function withAdmin(
	options: {
		permission?: string;
		requireCsrf?: boolean;
		maxBodyBytes?: number;
	},
	handler: AdminHandler,
) {
	// No default value here on purpose. `RouteContext` already has an optional
	// `params`, so `{}` was always assignable and the default only widened the
	// parameter to `RouteContext | undefined`. Next's generated route types assert
	// the second argument against `ParamCheck<RouteContext>`, and the `undefined`
	// fails that check. `tsc --noEmit` does not see it, because Next only adds
	// `.next/types` to the project during a production build.
	// Deliberately no default. A parameter with a default is optional in the
	// signature, which makes its type `RouteContext | undefined` and fails Next's
	// `ParamCheck`. Tests that call a handler directly pass `emptyRouteContext()`.
	return async (request: NextRequest, routeContext: RouteContext) => {
		const store = createStore("unknown" as IpAddress);
		const { value: response, metrics } = await collectPerformance(() =>
			runWithStore(store, async () => {
				// CSRF required for mutating admin APIs unless explicitly opted out.
				const csrfRequired =
					options.requireCsrf !== false && MUTATING_METHODS.has(request.method);
				if (csrfRequired) {
					const csrfToken =
						request.headers.get("x-csrf-token") ??
						request.headers.get("csrf-token") ??
						"";
					const valid = await validateCsrfToken(csrfToken);
					if (!valid) {
						return NextResponse.json(
							{ ok: false, error: "Invalid or missing CSRF token" },
							{ status: 403 },
						);
					}
				}

				if (MUTATING_METHODS.has(request.method)) {
					const contentLength = request.headers.get("content-length");
					const maxBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
					if (contentLength && Number(contentLength) > maxBytes) {
						return NextResponse.json(
							{ ok: false, error: `Request body exceeds ${maxBytes} bytes` },
							{ status: 413 },
						);
					}
				}

				const context = await getApiAdminContext();
				if (!context)
					return NextResponse.json(
						{ ok: false, error: "Unauthorized" },
						{ status: 401 },
					);
				if (
					options.permission &&
					!canAccess(
						context.permissions,
						options.permission,
						context.session.user.rank,
					)
				) {
					await logAuthorizationEvent({
						kind: "permission.denied",
						userId: context.session.user.id,
						username: context.session.user.username,
						rank: context.session.user.rank,
						permission: options.permission,
						source: request.nextUrl.pathname,
						reason: "API permission check denied",
					});
					return NextResponse.json(
						{ ok: false, error: "Forbidden" },
						{ status: 403 },
					);
				}
				setContextUserId(Number(context.session.user.id) as UserId);
				let finishExport: (() => Promise<void>) | undefined;
				try {
					if (
						catalogExportEnabled() &&
						isCatalogMutation(request.method, request.nextUrl.pathname)
					) {
						finishExport = await beginCatalogExport();
					}
					const response = await handler(request, context, routeContext);
					if (
						finishExport &&
						response.body &&
						response.headers.get("content-type")?.includes("text/event-stream")
					) {
						const [client, completion] = response.body.tee();
						const finish = finishExport;
						after(async () => {
							const reader = completion.getReader();
							try {
								while (!(await reader.read()).done) {
									/* Wait for all import results. */
								}
							} finally {
								reader.releaseLock();
								await finish();
							}
						});
						return new Response(client, {
							status: response.status,
							headers: response.headers,
						});
					}
					await finishExport?.();
					return response;
				} catch (error) {
					await finishExport?.().catch(() => undefined);
					const errorId = logServerError("admin.api_failed", error, {
						path: request.nextUrl.pathname,
						userId: context.session.user.id,
					});
					return NextResponse.json(
						{ ok: false, error: "Internal server error", errorId },
						{ status: 500 },
					);
				}
			}),
		);
		if (store.userId !== null) {
			recordPerformance({
				operationId: store.requestId,
				route: routeTemplate(
					request.nextUrl.pathname,
					// Next always passes a context, and the type requires it, so
					// this is only a guard against a direct internal call. The
					// worst case is a slightly less specific metric label, which
					// is not worth a 500.
					await routeContext?.params,
				),
				method: request.method,
				status: response.status,
				at: Date.now(),
				metrics,
				streaming:
					response.headers.get("content-type")?.includes("text/event-stream") ??
					false,
			});
		}
		const headers = new Headers(response.headers);
		headers.set("x-operation-id", store.requestId);
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	};
}
