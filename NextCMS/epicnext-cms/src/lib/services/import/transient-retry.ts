const TRANSIENT_ERROR_PATTERN =
	/fetch failed|network|socket|timeout|timed out|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|HTTP 5\d\d|Empty or truncated response|service unavailable|temporarily unavailable/i;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** True for download/connection hiccups worth a retry; false for data errors. */
export function isTransientImportError(message: string | undefined): boolean {
	if (!message) return false;
	return TRANSIENT_ERROR_PATTERN.test(message);
}

/**
 * Runs `attempt` again (with backoff) when it returns a transient failure.
 * Non-transient failures and hard throws are returned/raised immediately.
 */
export async function withTransientImportRetry<
	T extends { ok: boolean; error?: string },
>(attempt: () => Promise<T>, retries = 2): Promise<T> {
	for (let n = 0; ; n++) {
		const result = await attempt();
		if (result.ok || !isTransientImportError(result.error) || n >= retries)
			return result;
		const delay = Math.min(400 * 2 ** n, 2000);
		await sleep(delay);
	}
}
