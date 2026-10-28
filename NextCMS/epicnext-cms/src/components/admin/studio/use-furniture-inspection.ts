"use client";
import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/admin-fetch";
import type { FurnitureInspection } from "@/lib/furni/studio-inspection";
export function useFurnitureInspection(classnames: string[]) {
	const [attempt, setAttempt] = useState(0);
	const key = JSON.stringify({ classnames, attempt });
	const [state, setState] = useState<{
		key: string;
		items: FurnitureInspection[];
		error: string;
		loading: boolean;
	}>({ key: "", items: [], error: "", loading: true });
	useEffect(() => {
		const abort = new AbortController();
		setState({ key, items: [], error: "", loading: true });
		void (async () => {
			try {
				const names = JSON.parse(key).classnames as string[];
				const inspected: FurnitureInspection[] = [];
				for (let offset = 0; offset < names.length; offset += 500) {
					const res = await adminFetch("/cms_api/admin/studio/inspect", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							classnames: names.slice(offset, offset + 500),
						}),
						signal: abort.signal,
					});
					const data = await res.json();
					if (!res.ok || !Array.isArray(data.items))
						throw new Error(data.error || "Could not inspect local furniture");
					inspected.push(...data.items);
				}
				if (!abort.signal.aborted)
					setState({ key, items: inspected, error: "", loading: false });
			} catch (error) {
				if (!abort.signal.aborted)
					setState({
						key,
						items: [],
						error: (error as Error).message,
						loading: false,
					});
			}
		})();
		return () => abort.abort();
	}, [key]);
	return {
		...state,
		loading: state.key !== key || state.loading,
		retry: () => setAttempt((value) => value + 1),
	};
}
