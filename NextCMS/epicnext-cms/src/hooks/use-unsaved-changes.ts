"use client";
import { useCallback, useEffect, useRef } from "react";

interface Guard {
	dirty: boolean;
	message: string;
}
const guards = new Set<{ current: Guard }>();
/** Call before programmatic navigation that would replace an unsaved form. */
export function confirmUnsavedNavigation(): boolean {
	const guard = [...guards].find((entry) => entry.current.dirty)?.current;
	return !guard || window.confirm(guard.message);
}
function leavesCurrentPage(href: string) {
	const target = new URL(href, location.href);
	return (
		(target.protocol === "http:" || target.protocol === "https:") &&
		(target.origin !== location.origin ||
			target.pathname !== location.pathname ||
			target.search !== location.search)
	);
}
function beforeUnload(event: BeforeUnloadEvent) {
	if (![...guards].some((entry) => entry.current.dirty)) return;
	event.preventDefault();
	event.returnValue = "";
}
function click(event: MouseEvent) {
	if (
		event.defaultPrevented ||
		event.button !== 0 ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.altKey
	)
		return;
	const link =
		event.target instanceof Element ? event.target.closest("a[href]") : null;
	if (
		!(link instanceof HTMLAnchorElement) ||
		link.hasAttribute("download") ||
		(link.target && link.target !== "_self") ||
		!leavesCurrentPage(link.href)
	)
		return;
	if (!confirmUnsavedNavigation()) {
		event.preventDefault();
		event.stopImmediatePropagation();
	}
}
interface HistoryNavigationEvent extends Event {
	navigationType: string;
	destination: { url: string };
}
function traverse(event: Event) {
	const navigation = event as HistoryNavigationEvent;
	if (
		navigation.navigationType !== "traverse" ||
		!event.cancelable ||
		!leavesCurrentPage(navigation.destination.url)
	)
		return;
	if (!confirmUnsavedNavigation()) event.preventDefault();
}
/** Protect reload, links and supported browser history traversals; expose explicit close protection. */
export function useUnsavedChanges(dirty: boolean, message: string) {
	const guard = useRef({ dirty, message });
	guard.current = { dirty, message };
	useEffect(() => {
		if (!dirty) return;
		const entry = guard;
		const navigation = (window as Window & { navigation?: EventTarget })
			.navigation;
		if (guards.size === 0) {
			window.addEventListener("beforeunload", beforeUnload);
			document.addEventListener("click", click, true);
			navigation?.addEventListener("navigate", traverse);
		}
		guards.add(entry);
		return () => {
			guards.delete(entry);
			if (guards.size === 0) {
				window.removeEventListener("beforeunload", beforeUnload);
				document.removeEventListener("click", click, true);
				navigation?.removeEventListener("navigate", traverse);
			}
		};
	}, [dirty]);
	const confirmLeave = useCallback(
		() => !guard.current.dirty || window.confirm(guard.current.message),
		[],
	);
	const markSaved = useCallback(() => {
		guard.current.dirty = false;
	}, []);
	return { confirmLeave, markSaved };
}
