const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_ENDPOINT = "/cms_api/admin/csrf";
const CSRF_ERROR = "Invalid or missing CSRF token";
const CSRF_TOKEN_LENGTH = 64;

let csrfBootstrapPromise: Promise<string> | null = null;

/** Read the CSRF token injected by the admin layout `<meta name="csrf-token">`. */
export function getCsrfToken(): string | null {
	if (typeof document === "undefined") return null;
	return (
		document
			.querySelector('meta[name="csrf-token"]')
			?.getAttribute("content") ?? null
	);
}

function writeCsrfToken(token: string) {
	let meta = document.querySelector('meta[name="csrf-token"]');
	if (!meta) {
		meta = document.createElement("meta");
		meta.setAttribute("name", "csrf-token");
		document.head.appendChild(meta);
	}
	meta.setAttribute("content", token);
}

async function bootstrapCsrfToken(): Promise<string> {
	if (csrfBootstrapPromise) return csrfBootstrapPromise;

	csrfBootstrapPromise = fetch(CSRF_ENDPOINT, {
		credentials: "same-origin",
		cache: "no-store",
	})
		.then(async (response) => {
			if (!response.ok) throw new Error("Unable to initialize CSRF token");
			const data = (await response.json()) as { token?: unknown };
			if (
				typeof data.token !== "string" ||
				data.token.length !== CSRF_TOKEN_LENGTH
			) {
				throw new Error("Invalid CSRF bootstrap response");
			}
			writeCsrfToken(data.token);
			return data.token;
		})
		.finally(() => {
			csrfBootstrapPromise = null;
		});

	return csrfBootstrapPromise;
}

async function isCsrfRejection(response: Response): Promise<boolean> {
	if (response.status !== 403) return false;
	try {
		const data = (await response.clone().json()) as { error?: unknown };
		return data.error === CSRF_ERROR;
	} catch {
		return false;
	}
}

/**
 * Same-origin fetch for admin APIs. Attaches `x-csrf-token` on mutating methods.
 */
export async function adminFetch(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const method = (init?.method ?? "GET").toUpperCase();
	const headers = new Headers(init?.headers);
	const mutating = MUTATING.has(method);
	if (mutating) {
		const token = getCsrfToken() ?? (await bootstrapCsrfToken());
		headers.set("x-csrf-token", token);
	}

	const requestInit = {
		...init,
		headers,
		credentials: init?.credentials ?? "same-origin",
	} satisfies RequestInit;
	const response = await fetch(input, requestInit);
	if (!mutating || !(await isCsrfRejection(response))) return response;

	const refreshedToken = await bootstrapCsrfToken();
	headers.set("x-csrf-token", refreshedToken);
	return fetch(input, { ...requestInit, headers });
}
