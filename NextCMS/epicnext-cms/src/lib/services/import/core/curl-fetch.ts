import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { promisify } from "node:util";
import { measureDependency } from "@/lib/performance-diagnostics";

const execFileAsync = promisify(execFile);

/**
 * Some retro CDNs (e.g. Leet.city) block Node's fetch by TLS fingerprint
 * (JA3/JA4) even though the same request succeeds from a real browser or
 * curl. This helper shells out to `curl` as a fallback for those hosts.
 *
 * The runtime image ships `curl-impersonate` (a curl compiled with Chrome's
 * exact TLS fingerprint, statically-bundled BoringSSL) at /opt/curl-impersonate
 * because several sources enable Cloudflare `cf-mitigated: challenge` against
 * the distro curl's fingerprint too. Prefer it when present, else fall back to
 * the system curl.
 */

const IMPERSONATE_CURL = "/opt/curl-impersonate/curl_chrome116";
const CURL_BIN = existsSync(IMPERSONATE_CURL) ? IMPERSONATE_CURL : "curl";

const CURL_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function curlArgs(url: string, extra: string[]): string[] {
	return [
		"-sSL",
		"--compressed",
		"--max-time",
		"30",
		"--connect-timeout",
		"10",
		"-A",
		CURL_USER_AGENT,
		"-H",
		"Accept: application/json,text/plain,*/*;q=0.9",
		"-H",
		"Accept-Language: en-US,en;q=0.9",
		...extra,
		url,
	];
}

/** Fetch a URL's body via curl. Throws on non-zero exit / timeout. */
export async function curlFetchText(
	url: string,
	timeoutMs = 30_000,
): Promise<string> {
	const { stdout } = await measureDependency("external", () =>
		execFileAsync(CURL_BIN, curlArgs(url, []), {
			timeout: timeoutMs,
			maxBuffer: 512 * 1024 * 1024,
		}),
	);
	return stdout;
}

/** Download a URL to a file via curl. Returns ok=false on failure (curl -f). */
export async function curlDownload(
	url: string,
	destPath: string,
	timeoutMs = 30_000,
	cookieHeader?: string,
): Promise<{ ok: boolean; size: number }> {
	try {
		const cookieArgs = cookieHeader ? ["-H", `Cookie: ${cookieHeader}`] : [];
		await measureDependency("external", () =>
			execFileAsync(
				CURL_BIN,
				[
					"-sSL",
					"--compressed",
					"--fail",
					"--max-time",
					"30",
					"--connect-timeout",
					"10",
					"-A",
					CURL_USER_AGENT,
					"-H",
					"Accept: application/octet-stream,*/*;q=0.9",
					"-H",
					"Accept-Language: en-US,en;q=0.9",
					...cookieArgs,
					"-o",
					destPath,
					url,
				],
				{ timeout: timeoutMs },
			),
		);
		const stat = await fs.stat(destPath);
		return { ok: stat.size > 0, size: stat.size };
	} catch {
		return { ok: false, size: 0 };
	}
}
