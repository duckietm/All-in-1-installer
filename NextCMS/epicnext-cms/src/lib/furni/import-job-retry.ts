import type { ImportJob } from "./import-job";
/** Never requeue an active job or furniture already imported successfully. */
export function retryableJobItems(job: ImportJob): ImportJob["items"] {
	if (job.state === "running" || job.state === "queued") return [];
	return job.items.filter(
		(item) =>
			(item.state === "failed" &&
				!item.error?.startsWith("Server restarted during import.")) ||
			((job.state === "interrupted" || job.state === "cancelled") &&
				(item.state === "pending" || item.state === "cancelled")),
	);
}
