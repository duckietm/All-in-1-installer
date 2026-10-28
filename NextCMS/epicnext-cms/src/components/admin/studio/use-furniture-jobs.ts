"use client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useVisiblePolling } from "@/hooks/use-visible-polling";
import { adminFetch } from "@/lib/admin-fetch";
import type { ImportJob, ImportJobItem } from "@/lib/furni/import-job";
import { createFurnitureImportRequests } from "./furniture-import-requests";
import {
	createFurnitureJobsClient,
	FurnitureJobsHttpError,
	type FurnitureJobsPage,
	furnitureJobsQueryOptions,
	readFurnitureJobResponse,
} from "./furniture-jobs-query";

const SETTLED_STATES = ["completed", "interrupted", "cancelled"];

export function useFurnitureJobs(
	onComplete: (settled: ImportJob[]) => void,
	paginated = false,
	actorId?: number,
) {
	const t = useTranslations("pages.admin.importHistory");
	const [client] = useState(createFurnitureJobsClient);
	const cursor = useRef<string | null>(null);
	const previous = useRef<Array<string | null>>([]);
	const [pageCursor, setPageCursor] = useState<string | null>(null);
	const [page, setPage] = useState(1);
	const query = useQuery(
		{ ...furnitureJobsQueryOptions(paginated, pageCursor), enabled: false },
		client,
	);
	const unauthorized =
		query.error instanceof FurnitureJobsHttpError &&
		[401, 403].includes(query.error.status);
	const jobs = unauthorized ? [] : (query.data?.jobs ?? []);
	const nextCursor = unauthorized ? null : (query.data?.nextCursor ?? null);
	const loading = query.isFetching;
	const error = query.error?.message ?? "";
	const [cancelling, setCancelling] = useState<string | null>(null);
	const cancelInFlight = useRef(false);
	const [busy, setBusy] = useState(false);
	const completed = useRef(new Set<string>());
	const callback = useRef(onComplete);
	callback.current = onComplete;
	const requests = useMemo(
		() => createFurnitureImportRequests(actorId),
		[actorId],
	);
	const submitting = useRef(false);
	useEffect(
		() => () => {
			client.clear();
		},
		[client],
	);
	const baselined = useRef(false);
	useEffect(() => {
		if (!query.data || unauthorized) return;
		const settled: ImportJob[] = [];
		for (const job of query.data.jobs) {
			if (!SETTLED_STATES.includes(job.state)) continue;
			if (completed.current.has(job.id)) continue;
			completed.current.add(job.id);
			settled.push(job);
		}
		// The first payload is history this component did not witness finishing.
		// Recording it as a baseline keeps a page load from replaying every past
		// import as "just settled", which would refetch the catalog on every visit.
		if (!baselined.current) {
			baselined.current = true;
			return;
		}
		if (settled.length > 0) callback.current(settled);
	}, [query.data, unauthorized]);
	const refresh = useCallback(async () => {
		// fetchQuery shares an in-flight GET. Query owns data, errors and loading.
		await client
			.fetchQuery(furnitureJobsQueryOptions(paginated, cursor.current))
			.catch(() => undefined);
	}, [client, paginated]);
	const resetPage = () => {
		cursor.current = null;
		previous.current = [];
		setPageCursor(null);
		setPage(1);
	};
	const navigate = async (direction: "next" | "previous") => {
		if (client.isFetching()) return;
		if (direction === "next" && nextCursor) {
			previous.current.push(cursor.current);
			cursor.current = nextCursor;
		} else if (direction === "previous" && previous.current.length)
			cursor.current = previous.current.pop() ?? null;
		else return;
		setPageCursor(cursor.current);
		setPage(previous.current.length + 1);
		await refresh();
	};
	const retry = async (id: string) => {
		if (submitting.current) return;
		submitting.current = true;
		setBusy(true);
		try {
			const response = await adminFetch("/api/admin/studio/import-jobs", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id, action: "retry" }),
			});
			await readFurnitureJobResponse(response, t("cancelFailed"));
			await client.cancelQueries();
			resetPage();
			await refresh();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("cancelFailed"));
		} finally {
			submitting.current = false;
			setBusy(false);
		}
	};
	const active = jobs.some(
		(job) => job.state === "queued" || job.state === "running",
	);
	// Retain settle-then-poll timing and visibility behavior without global focus state.
	useVisiblePolling(refresh, active ? 5000 : 30000);
	const cancel = async (id: string) => {
		if (cancelInFlight.current) return;
		cancelInFlight.current = true;
		setCancelling(id);
		try {
			const response = await adminFetch("/api/admin/studio/import-jobs", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id }),
			});
			const job = await readFurnitureJobResponse(response, t("cancelFailed"));
			await client.cancelQueries();
			client.setQueriesData<FurnitureJobsPage>(
				{ queryKey: ["furniture-import-history"] },
				(current) =>
					current
						? {
								...current,
								jobs: current.jobs.map((item) => (item.id === id ? job : item)),
							}
						: current,
			);
			await refresh();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("cancelFailed"));
		} finally {
			cancelInFlight.current = false;
			setCancelling(null);
		}
	};
	const submit = async (
		items: ImportJobItem[],
		options: {
			sourceId?: string;
			translate: boolean;
			langs?: string[];
			mode?: "repair";
		},
	) => {
		if (submitting.current) return false;
		submitting.current = true;
		setBusy(true);
		const body = { items, ...options },
			payload = JSON.stringify(body);

		try {
			const request = await requests.get(payload);
			const response = await adminFetch("/api/admin/studio/import-jobs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...body, id: request.id }),
			});
			const accepted = await readFurnitureJobResponse(
				response,
				"Could not queue import",
			);
			if (accepted.id !== request.id)
				throw Error("Could not confirm the queued import");
			requests.acknowledge(request);
			await client.cancelQueries();
			resetPage();
			await refresh();
			toast.success(
				"Import queued. You can leave this page and return to its history.",
			);
			return true;
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not queue import",
			);
			return false;
		} finally {
			submitting.current = false;
			setBusy(false);
		}
	};
	return {
		jobs,
		busy,
		error,
		submit,
		refresh,
		cancel,
		cancelling,
		retry,
		navigate,
		page,
		nextCursor,
		loading,
		paginated,
	};
}
