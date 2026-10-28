import type { AbstractIntlMessages } from "next-intl";

/**
 * Client-side message scoping.
 *
 * `getMessages()` hands back the whole catalogue, and the root layout feeds it
 * to `NextIntlClientProvider`, which serialises every message into the RSC
 * payload of every page. The catalogue is ~254 KB of which `pages.admin` and
 * `admin` together are ~195 KB — and no public page ever reads either.
 *
 * Nested `NextIntlClientProvider`s REPLACE the parent's messages rather than
 * merging them (see use-intl's IntlProvider: `messages ?? parent.messages`), so
 * a segment cannot ask for "just my part". The root layout therefore installs
 * the reduced catalogue, and the staff route groups (`/admin`, `/admin-next`,
 * `/mod`) each install a nested provider seeded with the full one, which keeps
 * staff tools complete while public pages ship ~59 KB instead of ~254 KB.
 */

/** Top-level namespaces plus `pages.*` sub-namespaces reserved for staff tools. */
const ADMIN_ONLY_NAMESPACES = new Set(["admin"]);
const ADMIN_ONLY_PAGE_NAMESPACES = new Set(["admin"]);

/**
 * `pages.admin` sub-namespaces that are NOT staff-only because a shared
 * client component reads them on public pages too.
 *
 * `useServerAction` (src/hooks/use-server-action.ts) resolves its default
 * success/error toast copy from `pages.admin.actions` and is used by
 * `/events/[slugOrId]` and `/polls/[id]`, so that one sub-namespace has to
 * survive the filter — the strings in it are generic ("Saved successfully."),
 * not staff-tool copy.
 */
const PUBLIC_PAGE_NAMESPACES = new Set(["actions"]);

/**
 * Drop the staff-tool namespaces from a full catalogue.
 *
 * A denylist rather than an allowlist on purpose: a new public page should work
 * immediately rather than silently 500 on a missing namespace, and the only
 * namespaces that must never reach a public client are the two admin ones. A
 * guard test asserts that no component under `app/(site)` references them.
 */
export function publicClientMessages(
	messages: AbstractIntlMessages,
): AbstractIntlMessages {
	const result: AbstractIntlMessages = {};

	for (const [key, value] of Object.entries(messages)) {
		if (ADMIN_ONLY_NAMESPACES.has(key)) continue;
		if (key !== "pages") {
			result[key] = value;
			continue;
		}

		const pages: AbstractIntlMessages = {};
		for (const [pageKey, pageValue] of Object.entries(
			value as AbstractIntlMessages,
		)) {
			if (!ADMIN_ONLY_PAGE_NAMESPACES.has(pageKey)) {
				pages[pageKey] = pageValue;
				continue;
			}
			// Staff-only page namespace: keep only the sub-namespaces that a
			// shared client component reads on public pages as well.
			const shared: AbstractIntlMessages = {};
			for (const [sharedKey, sharedValue] of Object.entries(
				pageValue as AbstractIntlMessages,
			)) {
				if (PUBLIC_PAGE_NAMESPACES.has(sharedKey)) {
					shared[sharedKey] = sharedValue;
				}
			}
			if (Object.keys(shared).length > 0) pages[pageKey] = shared;
		}
		result.pages = pages;
	}

	return result;
}
