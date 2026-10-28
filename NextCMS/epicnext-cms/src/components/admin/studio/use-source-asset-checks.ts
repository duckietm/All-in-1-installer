"use client";
import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/admin-fetch";
import type { SourceAssetCheck } from "@/lib/furni/source-assets";
import type { FurnitureInspection } from "@/lib/furni/studio-inspection";
import type { FurniItem } from "./studio-types";
export function useSourceAssetChecks(
	items: FurniItem[],
	sourceId: string | undefined,
	local: { items: FurnitureInspection[]; loading: boolean; error: string },
) {
	const [attempt, setAttempt] = useState(0);
	const needed = items.filter(
		(item) =>
			!local.items.some(
				(entry) =>
					entry.classname === item.classname && entry.nitro.exists === true,
			),
	);
	const key =
		local.loading || local.error
			? ""
			: JSON.stringify({ items: needed, sourceId, attempt });
	const [state, setState] = useState<{
		key: string;
		loading: boolean;
		error: string;
		items: SourceAssetCheck[];
	}>({ key: "", loading: true, error: "", items: [] });
	useEffect(() => {
		if (!key) return;
		const abort = new AbortController();
		setState({ key, loading: true, error: "", items: [] });
		void (async () => {
			const { items, sourceId } = JSON.parse(key) as {
				items: FurniItem[];
				sourceId?: string;
			};
			const results: SourceAssetCheck[] = [];
			try {
				for (let offset = 0; offset < items.length; offset += 20) {
					const res = await adminFetch("/api/admin/studio/source-assets", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							items: items.slice(offset, offset + 20),
							sourceId,
						}),
						signal: abort.signal,
					});
					const data = await res.json();
					if (!res.ok || !Array.isArray(data.items))
						throw Error(data.error || "Could not check source assets");
					results.push(...data.items);
					if (!abort.signal.aborted)
						setState({ key, items: [...results], loading: true, error: "" });
				}
				if (results.length !== items.length)
					throw Error("Source check is incomplete. Retry before importing.");
				if (!abort.signal.aborted)
					setState({ key, items: results, loading: false, error: "" });
			} catch (error) {
				if (!abort.signal.aborted)
					setState({
						key,
						items: [],
						loading: false,
						error: (error as Error).message,
					});
			}
		})();
		return () => abort.abort();
	}, [key]);
	return {
		...state,
		loading: !key || state.key !== key || state.loading,
		items: state.key === key ? state.items : [],
		retry: () => setAttempt((value) => value + 1),
	};
}
