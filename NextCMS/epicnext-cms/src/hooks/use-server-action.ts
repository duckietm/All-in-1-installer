"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { logger } from "@/lib/browser-log";
import type { ActionResult } from "@/lib/safe-action-shared";

interface UseServerActionOptions {
	/** Where to redirect after a successful action (optional) */
	redirectOnSuccess?: string;
}

interface RunOptions {
	successMessage?: string;
	errorMessage?: string;
	/** Override redirect path for this specific call */
	redirectTo?: string;
	/** Called on success with the result data. Overrides default router.refresh(). */
	onSuccess?: (data: Record<string, unknown>) => void;
	/** Called when the action fails or throws */
	onError?: () => void;
	/**
	 * Set only when the action calls `revalidatePath()` / `revalidateTag()` for
	 * the route being displayed. Next.js then re-renders that page as part of the
	 * action's own response and the router applies it with a seeded navigation,
	 * so the extra `router.refresh()` is a duplicate round-trip.
	 *
	 * The framework only skips its own update when the action did NOT revalidate
	 * and sent no flight data — see the bail-out in
	 * `next/dist/client/components/router-reducer/reducers/server-action-reducer.js`.
	 *
	 * Leaving this off is always safe. Setting it for an action that does not
	 * revalidate leaves the screen stale, so it is opt-in per call rather than
	 * derived from the action name.
	 */
	revalidated?: boolean;
}

/**
 * Hook that wraps a server action with loading state, toast notifications,
 * and optional redirect/refresh. Drop-in replacement for useAdminForm.
 *
 * @example
 * const { run, isPending } = useServerAction()
 *
 * // Submit
 * run(() => updateNews({ id, ...data }), { successMessage: 'Saved!' })
 *
 * // Delete with redirect
 * run(() => deleteNews(id), { redirectTo: '/admin/news' })
 */
export function useServerAction(options: UseServerActionOptions = {}) {
	const t = useTranslations("pages.admin.actions");
	const locked = useRef(false);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
	const [isPending, startTransition] = useTransition();
	const router = useRouter();

	function run(action: () => Promise<unknown>, opts: RunOptions = {}) {
		if (locked.current) return;
		locked.current = true;
		setFieldErrors({});
		const {
			successMessage = t("saved"),
			errorMessage = t("error"),
			redirectTo,
			onSuccess,
			onError,
			revalidated = false,
		} = opts;

		startTransition(async () => {
			try {
				const result = (await action()) as ActionResult | undefined;

				if (!result || result.ok) {
					toast.success(successMessage);
					if (onSuccess) {
						onSuccess((result?.data ?? {}) as Record<string, unknown>);
					} else {
						const target = redirectTo || options.redirectOnSuccess;
						if (target) router.push(target);
						// The action already revalidated the current route, so its
						// own response carried the new tree; refreshing again would
						// just re-fetch it.
						else if (!revalidated) router.refresh();
					}
				} else {
					setFieldErrors(result.fieldErrors ?? {});
					toast.error(result.error || errorMessage, {
						description:
							Object.values(result.fieldErrors ?? {})
								.flat()
								.join(" · ") || undefined,
					});
					onError?.();
				}
			} catch (err) {
				logger.error("[useServerAction] Unexpected error", {
					err: err as Error,
				});
				toast.error(errorMessage);
				onError?.();
			} finally {
				locked.current = false;
			}
		});
	}

	return { run, isPending, fieldErrors };
}
