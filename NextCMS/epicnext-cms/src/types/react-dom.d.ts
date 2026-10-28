import type { HTMLAttributes } from "react";

declare module "react" {
	interface IframeHTMLAttributes<T> extends HTMLAttributes<T> {
		/**
		 * Browser support for `fetchpriority` on iframes exists (Chrome 126+,
		 * Safari 17.5+, Firefox 129+); React forwards the `fetchPriority` prop
		 * to a `fetchpriority` attribute so the game document is fetched with
		 * high priority instead of competing with other resources.
		 */
		fetchPriority?: "high" | "low" | "auto";
	}
}
