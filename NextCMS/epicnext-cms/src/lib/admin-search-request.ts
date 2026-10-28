/** Owns the single request allowed to update a search dialog. */
export class AdminSearchRequest {
	private current: AbortController | null = null;

	cancel() {
		this.current?.abort();
		this.current = null;
	}

	start() {
		this.cancel();
		const controller = new AbortController();
		this.current = controller;
		return controller;
	}

	accepts(controller: AbortController) {
		return this.current === controller && !controller.signal.aborted;
	}
}
