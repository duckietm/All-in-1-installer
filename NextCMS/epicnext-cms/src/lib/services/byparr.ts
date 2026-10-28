const BYPARR_URL =
	process.env.BYPARR_URL ??
	process.env.FLARESOLVERR_URL ?? // legacy env fallback
	"http://localhost:8191";

const BYPARR_API = `${BYPARR_URL}/v1`;

type ByparrCookie = {
	name: string;
	value: string;
	domain?: string;
	path?: string;
};

type ByparrSolution = {
	response: string;
	status: number;
	cookies: ByparrCookie[];
};

type ByparrResult = {
	status?: "ok" | "error";
	message?: string;
	solution?: ByparrSolution;
	error?: string;
};

async function byparrRequest(
	url: string,
	timeout = 30000,
): Promise<ByparrSolution> {
	const res = await fetch(BYPARR_API, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			cmd: "request.get",
			url,
			maxTimeout: timeout,
		}),
		signal: AbortSignal.timeout(timeout + 5000),
	});

	if (!res.ok) {
		throw new Error(`Byparr request failed: ${res.status} ${res.statusText}`);
	}

	const data = (await res.json()) as ByparrResult;

	if (data.error) {
		throw new Error(`Byparr error: ${data.error}`);
	}

	// Byparr returns HTTP 200 with `status: "error"` for invalid requests
	// (FlareSolverr used a top-level `error` field instead).
	if (data.status && data.status !== "ok") {
		throw new Error(`Byparr error: ${data.message ?? "request failed"}`);
	}

	if (!data.solution) {
		throw new Error("Byparr: no solution in response");
	}

	return data.solution;
}

export async function fetchWithByparr(
	url: string,
	timeout = 30000,
): Promise<string> {
	const solution = await byparrRequest(url, timeout);
	return solution.response;
}

/**
 * Solve a Cloudflare challenge for the given URL and return the clearance
 * cookies as a `-b "name=value; ..."` argument string suitable for curl.
 * Returns null if Byparr is unavailable or no cookies were set.
 */
export async function getByparrCookies(
	url: string,
	timeout = 30000,
): Promise<string | null> {
	try {
		const solution = await byparrRequest(url, timeout);
		if (!solution.cookies?.length) return null;
		return solution.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
	} catch {
		return null;
	}
}
