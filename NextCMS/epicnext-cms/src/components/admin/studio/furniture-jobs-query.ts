import { QueryClient, queryOptions } from "@tanstack/react-query";
import {
	array as zArray,
	boolean as zBoolean,
	enum as zEnum,
	int as zInt,
	iso as zIso,
	literal as zLiteral,
	looseObject as zLooseObject,
	maxLength as zMaxLength,
	nonnegative as zNonnegative,
	nullable as zNullable,
	number as zNumber,
	object as zObject,
	optional as zOptional,
	positive as zPositive,
	refine as zRefine,
	regex as zRegex,
	string as zString,
	uuid as zUuid,
} from "zod/mini";
import { adminFetch } from "@/lib/admin-fetch";
import { IMPORT_PHASES, type ImportJob } from "@/lib/furni/import-job";

const endpoint = "/api/admin/studio/import-jobs";
const historyTimeoutMs = 15_000;
const jobSchema = zLooseObject({
	id: zUuid(),
	userId: zInt().check(zPositive()),
	createdAt: zIso.datetime({ offset: true }),
	updatedAt: zIso.datetime({ offset: true }),
	state: zEnum(["queued", "running", "completed", "interrupted", "cancelled"]),
	translate: zBoolean(),
	mode: zOptional(zLiteral("repair")),
	syncKind: zOptional(zEnum(["official", "clone"])),
	operationId: zOptional(zString()),
	retryOf: zOptional(zString()),
	sourceId: zOptional(zString()),
	cancelRequested: zOptional(zBoolean()),
	langs: zOptional(zArray(zString())),
	items: zArray(
		zLooseObject({
			id: zInt().check(zNonnegative()),
			classname: zString(),
			name: zString(),
			description: zString(),
			type: zString(),
			revision: zNumber(),
			category: zString(),
			state: zEnum([
				"pending",
				"running",
				"done",
				"failed",
				"cancelled",
				"interrupted",
			]),
			phase: zOptional(zEnum(IMPORT_PHASES)),
			phaseStartedAt: zOptional(zIso.datetime({ offset: true })),
			sourceAttempt: zOptional(zString()),
			recoveredSource: zOptional(
				zObject({
					sourceId: zString(),
					sourceName: zString(),
					revision: zNumber(),
				}),
			),
			error: zOptional(zString()),
			warnings: zOptional(zArray(zString())),
			itemId: zOptional(zNumber()),
		}),
	),
});
const historySchema = zObject({
	ok: zLiteral(true),
	jobs: zArray(jobSchema).check(zMaxLength(30)),
	nextCursor: zOptional(
		zNullable(
			zString().check(
				zRegex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[0-9a-f-]{36}$/i),
				zRefine((value) => {
					const [timestamp, id] = value.split("|");
					return (
						zIso.datetime({ precision: 3 }).safeParse(timestamp).success &&
						zUuid().safeParse(id).success
					);
				}),
			),
		),
	),
});
export interface FurnitureJobsPage {
	jobs: ImportJob[];
	nextCursor: string | null;
}
export class FurnitureJobsHttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}
async function responseData(
	response: Response,
	fallback: string,
): Promise<unknown> {
	const data: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const message =
			data &&
			typeof data === "object" &&
			"error" in data &&
			typeof data.error === "string"
				? data.error
				: `${fallback} (${response.status})`;
		throw new FurnitureJobsHttpError(message, response.status);
	}
	return data;
}
export async function readFurnitureJobResponse(
	response: Response,
	fallback: string,
): Promise<ImportJob> {
	const data = await responseData(response, fallback);
	const parsed = zObject({ ok: zLiteral(true), job: jobSchema }).safeParse(
		data,
	);
	if (!parsed.success) throw Error("Invalid import job response");
	return parsed.data.job as ImportJob;
}
/** Each mounted history owns this client; no persisted or cross-page account cache. */
export function createFurnitureJobsClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				networkMode: "always",
				staleTime: 0,
				gcTime: 0,
				refetchOnWindowFocus: false,
				refetchOnReconnect: false,
			},
			mutations: { retry: false },
		},
	});
}
export function furnitureJobsQueryOptions(
	paginated: boolean,
	cursor: string | null,
	timeoutMs = historyTimeoutMs,
) {
	return queryOptions({
		queryKey: [
			"furniture-import-history",
			paginated,
			paginated ? cursor : null,
		] as const,
		queryFn: async ({ signal }): Promise<FurnitureJobsPage> => {
			const timeout = AbortSignal.timeout(timeoutMs);
			const combined = AbortSignal.any([signal, timeout]);
			const url = new URL(
				endpoint,
				typeof window === "undefined"
					? "http://localhost"
					: window.location.origin,
			);
			if (paginated) {
				url.searchParams.set("page", "1");
				if (cursor) url.searchParams.set("before", cursor);
			}
			try {
				const response = await adminFetch(url, {
					signal: combined,
					cache: "no-store",
				});
				const data = await responseData(response, "Import history unavailable");
				const parsed = historySchema.safeParse(data);
				if (!parsed.success) throw Error("Invalid import history response");
				return {
					jobs: parsed.data.jobs as ImportJob[],
					nextCursor: parsed.data.nextCursor ?? null,
				};
			} catch (error) {
				if (timeout.aborted && !signal.aborted)
					throw Error("Import history request timed out");
				throw error;
			}
		},
	});
}
