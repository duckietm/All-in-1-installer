import { promises as fs } from "node:fs";
import { logger } from "@/lib/logger";
import { getByparrCookies } from "@/lib/services/byparr";
import {
	detectNitroTextureFormat,
	parseNitroBundle,
} from "../../swf/nitro-builder";
import { browserHeaders } from "./browser-headers";
import { curlDownload } from "./curl-fetch";

export function validateSwfBytes(buffer: Buffer): boolean {
	if (buffer.length < 8) return false;
	const sig = buffer.toString("ascii", 0, 3);
	return sig === "FWS" || sig === "CWS" || sig === "ZWS";
}

export function validatePngBytes(buffer: Buffer): boolean {
	if (buffer.length < 8) return false;
	return (
		buffer[0] === 137 &&
		buffer[1] === 80 &&
		buffer[2] === 78 &&
		buffer[3] === 71
	);
}

export function validateNitroBytes(buffer: Buffer): boolean {
	try {
		const bundle = parseNitroBundle(buffer);
		return (
			!!bundle.json &&
			typeof bundle.json === "object" &&
			!Array.isArray(bundle.json) &&
			// parseNitroBundle already rejects non-PNG/WebP textures, so this
			// is a cheap re-assertion rather than the real gate.
			detectNitroTextureFormat(bundle.texture) !== null
		);
	} catch {
		return false;
	}
}

export async function tryDownloadCandidates(
	urls: string[],
	destPath: string,
	kind: "swf" | "png",
	onFailure?: (detail: string) => void,
): Promise<boolean> {
	for (const url of urls) {
		const res = await downloadFile(url, destPath, { validate: kind });
		if (res.ok) return true;
		const source = new URL(url);
		onFailure?.(
			`${source.host}${source.pathname}: ${res.error ?? "download failed"}`,
		);
	}
	return false;
}

export async function downloadFile(
	url: string,
	destPath: string,
	options?: { maxRetries?: number; validate?: "swf" | "png" | "nitro" },
): Promise<{ ok: boolean; size: number; error?: string }> {
	const maxRetries = options?.maxRetries ?? 3;
	const baseDelay = 1000;

	const curlFallback = async (): Promise<boolean> => {
		let curlRes = await curlDownload(url, destPath);
		if (!curlRes.ok) {
			const cookieHeader = await getByparrCookies(url);
			curlRes = await curlDownload(
				url,
				destPath,
				30_000,
				cookieHeader ?? undefined,
			);
		}
		if (!curlRes.ok) return false;
		const validate = options?.validate;
		if (validate) {
			let valid = false;
			try {
				const buffer = await fs.readFile(destPath);
				valid =
					(validate === "swf" && validateSwfBytes(buffer)) ||
					(validate === "png" && validatePngBytes(buffer)) ||
					(validate === "nitro" && validateNitroBytes(buffer));
			} catch {
				valid = false;
			}
			if (!valid) {
				await fs.unlink(destPath).catch(() => {});
				return false;
			}
		}
		return true;
	};

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		let stage: "download" | "write" = "download";
		try {
			if (attempt > 0) {
				await new Promise((r) => setTimeout(r, baseDelay * 2 ** (attempt - 1)));
			}
			const res = await fetch(url, {
				signal: AbortSignal.timeout(15000),
				headers: browserHeaders("image", {
					Accept: "image/png,image/*,*/*;q=0.8",
				}),
			});
			if (!res.ok) {
				const deterministic =
					res.status === 404 || res.status === 410 || res.status === 403;
				if (deterministic || attempt === maxRetries) {
					// HTTP 403 is often a TLS-fingerprint / Cloudflare challenge
					// block (e.g. Leet.city) — retry via curl, with Byparr
					// clearance cookies if the plain curl is also challenged.
					if (res.status === 403 && (await curlFallback())) {
						const stat = await fs.stat(destPath);
						return { ok: true, size: stat.size };
					}
					logger.warn(
						`[import-download] Download failed ${url}: ${res.status}${deterministic ? " (deterministic, not retrying)" : ` after ${maxRetries + 1} attempts`}`,
					);
					return { ok: false, size: 0, error: `HTTP ${res.status}` };
				}
				continue;
			}
			const buffer = Buffer.from(await res.arrayBuffer());
			if (buffer.length < 8) {
				if (attempt === maxRetries)
					return { ok: false, size: 0, error: "Empty or truncated response" };
				continue;
			}
			if (options?.validate === "swf" && !validateSwfBytes(buffer)) {
				if (attempt === maxRetries) {
					logger.warn(`[import-download] Invalid SWF magic bytes from ${url}`);
					return { ok: false, size: 0, error: "Response is not a SWF file" };
				}
				continue;
			}
			if (options?.validate === "png" && !validatePngBytes(buffer)) {
				if (attempt === maxRetries) {
					logger.warn(`[import-download] Invalid PNG magic bytes from ${url}`);
					return { ok: false, size: 0, error: "Response is not a PNG file" };
				}
				continue;
			}
			if (options?.validate === "nitro" && !validateNitroBytes(buffer))
				return { ok: false, size: 0, error: "Invalid Nitro bundle" };
			stage = "write";
			await fs.writeFile(/*turbopackIgnore: true*/ destPath, buffer);
			return { ok: true, size: buffer.length };
		} catch (err) {
			if (attempt === maxRetries || stage === "write") {
				// TLS fingerprint aborts land here too — try curl/Byparr
				// before reporting the network failure.
				if (stage === "download" && (await curlFallback())) {
					const stat = await fs.stat(destPath);
					return { ok: true, size: stat.size };
				}
				logger.warn(
					`[import-download] Download error ${url}: ${(err as Error).message}`,
				);
				const failure = err as {
					code?: string;
					name?: string;
					cause?: { code?: string };
				};
				const code =
					failure.code ?? failure.cause?.code ?? failure.name ?? "unknown";
				return {
					ok: false,
					size: 0,
					error: `${stage === "write" ? "Cannot save file" : "Network failure"} (${code})`,
				};
			}
		}
	}
	return { ok: false, size: 0 };
}
