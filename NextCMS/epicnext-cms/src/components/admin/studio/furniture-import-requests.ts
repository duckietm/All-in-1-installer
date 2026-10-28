type RequestIdentity = { key: string; id: string };
type RequestStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Store only request identities; furniture payloads and files stay out of browser storage. */
export function createFurnitureImportRequests(
	actorId?: number,
	storage: () => RequestStorage = () => sessionStorage,
) {
	const pending = new Map<string, string>();
	const scoped = Number.isSafeInteger(actorId) && Number(actorId) > 0;
	return {
		async get(payload: string): Promise<RequestIdentity> {
			const digest = await crypto.subtle.digest(
				"SHA-256",
				new TextEncoder().encode(payload),
			);
			const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
				byte.toString(16).padStart(2, "0"),
			).join("");
			const key = `furniture-import-request:studio:${actorId ?? "memory"}:${fingerprint}`;
			let id = pending.get(key);
			if (!id && scoped) {
				try {
					const stored = storage().getItem(key);
					if (
						stored &&
						/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
							stored,
						)
					)
						id = stored;
				} catch {
					/* Keep in-memory recovery when browser storage is unavailable. */
				}
			}
			id ||= crypto.randomUUID();
			pending.set(key, id);
			if (scoped) {
				try {
					storage().setItem(key, id);
				} catch {
					/* The current page can still retry safely. */
				}
			}
			return { key, id };
		},
		acknowledge(request: RequestIdentity) {
			if (pending.get(request.key) === request.id) pending.delete(request.key);
			if (scoped) {
				try {
					if (storage().getItem(request.key) === request.id)
						storage().removeItem(request.key);
				} catch {
					/* A later replay remains safe on the server. */
				}
			}
		},
	};
}
