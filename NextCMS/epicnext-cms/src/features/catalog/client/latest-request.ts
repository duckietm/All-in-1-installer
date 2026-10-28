/** Cancels replaced requests and rejects late completions, even if transport ignores abort. */
export function createLatestRequest() {
	let current: AbortController | null = null;
	return {
		start() {
			current?.abort();
			const controller = new AbortController();
			current = controller;
			return {
				signal: controller.signal,
				isCurrent: () => current === controller && !controller.signal.aborted,
			};
		},
		cancel() {
			current?.abort();
			current = null;
		},
	};
}
