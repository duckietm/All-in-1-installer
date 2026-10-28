"use client";
import { useCallback, useEffect, useRef } from "react";
import {
	type CatalogSelection,
	readCatalogSelection,
	writeCatalogSelection,
} from "./catalog-selection-url";

export function requestCatalogNavigation() {
	return window.dispatchEvent(
		new Event("catalog:before-navigation", { cancelable: true }),
	);
}

/** Selection history stays local: changing category does not reload the server page. */
export function useCatalogNavigation({
	enabled,
	restore,
	mayLeave,
}: {
	enabled: boolean;
	restore: (selection: CatalogSelection) => void;
	mayLeave: () => boolean;
}) {
	const current = useRef({ restore, mayLeave });
	useEffect(() => {
		current.current = { restore, mayLeave };
	}, [restore, mayLeave]);
	const previousUrl = useRef("");
	const position = useRef(0);
	const restoringHistory = useRef(false);
	useEffect(() => {
		if (!enabled) return;
		previousUrl.current = window.location.href;
		position.current = window.history.state?.catalogSelectionPosition ?? 0;
		window.history.replaceState(
			{ ...window.history.state, catalogSelectionPosition: position.current },
			"",
		);
		current.current.restore(
			readCatalogSelection(new URL(window.location.href)),
		);
		const onPopState = () => {
			if (restoringHistory.current) {
				restoringHistory.current = false;
				return;
			}
			const targetPosition = window.history.state?.catalogSelectionPosition;
			if (!current.current.mayLeave()) {
				if (
					typeof targetPosition === "number" &&
					targetPosition !== position.current
				) {
					restoringHistory.current = true;
					window.history.go(position.current - targetPosition);
					return;
				}
				window.history.replaceState(
					window.history.state,
					"",
					previousUrl.current,
				);
				return;
			}
			position.current =
				typeof targetPosition === "number" ? targetPosition : position.current;
			previousUrl.current = window.location.href;
			current.current.restore(
				readCatalogSelection(new URL(window.location.href)),
			);
		};
		const onLink = (event: MouseEvent) => {
			if (
				event.defaultPrevented ||
				event.button !== 0 ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey ||
				event.altKey
			)
				return;
			const link = (event.target as Element).closest?.(
				"a[href]",
			) as HTMLAnchorElement | null;
			if (
				!link ||
				link.target === "_blank" ||
				link.hasAttribute("download") ||
				link.href === window.location.href
			)
				return;
			if (!current.current.mayLeave()) {
				event.preventDefault();
				event.stopPropagation();
			}
		};
		const onNavigation = (event: Event) => {
			if (!current.current.mayLeave()) event.preventDefault();
		};
		window.addEventListener("catalog:before-navigation", onNavigation);
		window.addEventListener("popstate", onPopState);
		document.addEventListener("click", onLink, true);
		return () => {
			window.removeEventListener("catalog:before-navigation", onNavigation);
			window.removeEventListener("popstate", onPopState);
			document.removeEventListener("click", onLink, true);
		};
	}, [enabled]);
	return useCallback(
		(selection: CatalogSelection) => {
			if (!enabled) return;
			const url = writeCatalogSelection(
				new URL(window.location.href),
				selection,
			);
			if (url.href !== window.location.href) {
				position.current += 1;
				window.history.pushState(
					{
						...window.history.state,
						catalogSelectionPosition: position.current,
					},
					"",
					url,
				);
			}
			previousUrl.current = url.href;
		},
		[enabled],
	);
}
