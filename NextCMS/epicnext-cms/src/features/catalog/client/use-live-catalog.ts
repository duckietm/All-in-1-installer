"use client";

import { useEffect, useSyncExternalStore } from "react";
import { adminFetch } from "@/lib/admin-fetch";
import type { TreeNode } from "@/types/catalog";
import {
	applyCatalogTotals,
	applyCatalogTreeDelta,
	type CatalogTotals,
	type CatalogTreeDelta,
	isEmptyCatalogDelta,
	normalizeCatalogTotals,
	normalizeTreePages,
} from "./live-catalog-merge";

export type CatalogMode = "normal" | "bc";

interface LiveCatalogSnapshot {
	tree: TreeNode[];
	totals: Record<CatalogMode, CatalogTotals | null>;
	treeLoaded: boolean;
	/** Catalog state the tree was read at, as bumped by `sendCatalogUpdate()`. */
	revision: string | null;
	/** A read is in flight; the rail shows this instead of pretending to be live. */
	refreshing: boolean;
	/** Last read failure. Never swallowed: a rail that cannot refresh must say so. */
	refreshError: string | null;
}

const EMPTY_SNAPSHOT: LiveCatalogSnapshot = {
	tree: [],
	totals: { normal: null, bc: null },
	treeLoaded: false,
	revision: null,
	refreshing: false,
	refreshError: null,
};

// A module-level external store keeps the catalog tree alive across client
// navigations and — more importantly — lets an import push its delta straight
// into the mounted tree instead of re-rendering the whole route.
let snapshot: LiveCatalogSnapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();

function emit(next: LiveCatalogSnapshot) {
	snapshot = next;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => EMPTY_SNAPSHOT;

export function useLiveCatalog(): LiveCatalogSnapshot {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Non-React read of the same snapshot `useLiveCatalog` subscribes to. */
export function getLiveCatalogSnapshot(): LiveCatalogSnapshot {
	return snapshot;
}

// ── Reads ──────────────────────────────────────────────────────────────────

/**
 * Adopt server-rendered totals as the baseline. Only the first value per mode
 * wins: after an import the store holds counts that are newer than any re-render
 * of the server prop (which is itself `unstable_cache`d for 30s).
 */
export function seedCatalogTotals(
	mode: CatalogMode,
	totals: CatalogTotals | null | undefined,
): void {
	if (!totals) return;
	if (snapshot.totals[mode]) return;
	emit({
		...snapshot,
		totals: { ...snapshot.totals, [mode]: { ...totals } },
	});
}

/**
 * Fold an import run's changes into the live tree and totals. Safe to call from
 * an event handler; a delta that changes nothing leaves the snapshot untouched.
 */
export function applyCatalogDelta(delta: CatalogTreeDelta): void {
	if (isEmptyCatalogDelta(delta)) return;
	const normal = snapshot.totals.normal;
	emit({
		...snapshot,
		tree: applyCatalogTreeDelta(snapshot.tree, delta),
		totals: {
			...snapshot.totals,
			normal: normal ? applyCatalogTotals(normal, delta) : null,
		},
	});
}

const TREE_URL = "/cms_api/admin/catalog/tree?mode=full";
const REVISION_URL = "/cms_api/admin/catalog/revision";
const CHANNEL = "atom-cms-catalog";

/** Last ETag the server handed out, replayed as `If-None-Match` on the next read. */
let treeEtag: string | null = null;
let treeRequest: Promise<void> | null = null;
let treeRequestQueued = false;

async function loadTree(): Promise<void> {
	const res = await adminFetch(
		TREE_URL,
		treeEtag
			? { cache: "no-store", headers: { "if-none-match": treeEtag } }
			: { cache: "no-store" },
	);
	// 304 means the catalog state this tree was read at is still current: nothing
	// changed, so nothing to re-render. This is what keeps the poll cheap on a
	// large catalog, where the flat tree is by far the biggest payload here.
	if (res.status === 304) {
		emit({ ...snapshot, refreshing: false, refreshError: null });
		return;
	}
	if (!res.ok) throw new Error(`Catalog tree refresh failed (${res.status})`);
	treeEtag = res.headers.get("etag") ?? treeEtag;
	const data = await res.json();
	// The route answers with live totals alongside the tree: importing writes
	// catalog rows server-side, so the numbers the store holds would otherwise
	// stay pre-import for the rest of the session.
	const totals = normalizeCatalogTotals(data?.totals);
	const revision =
		typeof data?.revision === "string" ? data.revision : snapshot.revision;
	emit({
		...snapshot,
		tree: normalizeTreePages(data?.pages),
		totals: {
			...snapshot.totals,
			normal: totals ?? snapshot.totals.normal,
		},
		treeLoaded: true,
		revision,
		refreshing: false,
		refreshError: null,
	});
	if (revision) broadcastRevision(revision);
}

/**
 * Reload the whole tree and totals over the API. Used where the server decides
 * the shape of the result — the furniture importers derive their category pages
 * from furnidata, so there is nothing for the client to predict. Still a plain
 * in-place data update: no route re-render, no remount, no lost editor state.
 *
 * Concurrent calls share one request, and a call that lands while one is in
 * flight queues a single follow-up read: the in-flight snapshot may predate the
 * write that triggered it. That keeps a burst of catalog mutations to one
 * extra read instead of one read each.
 */
export function refreshCatalogTree(): Promise<void> {
	if (treeRequest) {
		treeRequestQueued = true;
		return treeRequest;
	}
	if (!snapshot.refreshing) emit({ ...snapshot, refreshing: true });
	treeRequest = (async () => {
		try {
			do {
				treeRequestQueued = false;
				await loadTree();
			} while (treeRequestQueued);
		} catch (error) {
			// Keep the previous tree — stale beats empty — but never silently:
			// without an error in the snapshot the rail would show pre-import
			// counts as if they were current.
			treeEtag = null;
			emit({
				...snapshot,
				refreshing: false,
				refreshError:
					error instanceof Error ? error.message : "Catalog refresh failed",
			});
		} finally {
			treeRequest = null;
		}
	})();
	return treeRequest;
}

/**
 * Compare the server's revision against the one this tree was read at and
 * refresh only when they differ. Cheap enough to run on every mount, on every
 * focus and on a slow poll, which is what closes the gaps a single-tab store
 * leaves: an import finished in another tab, another browser or the job worker
 * has to show up here too.
 */
export async function checkCatalogRevision(): Promise<void> {
	const res = await adminFetch(REVISION_URL, { cache: "no-store" });
	// A failed probe is not worth reporting: the tree itself may be perfectly
	// current, and the next poll tries again.
	if (!res.ok) return;
	let revision: unknown;
	try {
		revision = (await res.json())?.revision;
	} catch {
		return;
	}
	if (typeof revision !== "string" || !revision) return;
	if (revision === snapshot.revision) return;
	await refreshCatalogTree();
}

/**
 * Load the tree when this session has none, otherwise ask the server whether
 * what we hold is still current. The tree used to be read once per session,
 * which is exactly why a session that started before an import could keep
 * showing the pre-import catalog.
 */
export function ensureCatalogTreeLoaded(): Promise<void> {
	return snapshot.treeLoaded ? checkCatalogRevision() : refreshCatalogTree();
}

// ── Cross-tab ────────────────────────────────────────────────────────────

let channel: BroadcastChannel | null = null;

function broadcastRevision(revision: string): void {
	// One tab's refresh tells the others; their own refresh then finds the
	// revision it already has and stops, so this cannot loop.
	channel?.postMessage({ revision });
}

function getChannel(): BroadcastChannel | null {
	if (channel || typeof BroadcastChannel === "undefined") return channel;
	channel = new BroadcastChannel(CHANNEL);
	channel.addEventListener("message", (event) => {
		const revision = (event.data as { revision?: unknown } | null)?.revision;
		if (typeof revision !== "string" || revision === snapshot.revision) return;
		void refreshCatalogTree();
	});
	return channel;
}

/**
 * Keep a mounted admin view honest about catalog writes it did not make itself:
 * load once, then poll the server revision, re-check on focus, and follow
 * writes from other tabs. Mount it once per view that renders the tree.
 */
export function useCatalogSync(intervalMs = 20_000): void {
	useEffect(() => {
		void ensureCatalogTreeLoaded();
		getChannel();
		const recheck = () => {
			if (document.visibilityState === "visible") void checkCatalogRevision();
		};
		const interval = setInterval(recheck, intervalMs);
		document.addEventListener("visibilitychange", recheck);
		window.addEventListener("focus", recheck);
		return () => {
			clearInterval(interval);
			document.removeEventListener("visibilitychange", recheck);
			window.removeEventListener("focus", recheck);
		};
	}, [intervalMs]);
}

/** Test seam: drop all live catalog state between cases. */
export function resetLiveCatalogForTests(): void {
	treeRequest = null;
	treeRequestQueued = false;
	treeEtag = null;
	channel?.close();
	channel = null;
	emit(EMPTY_SNAPSHOT);
}
