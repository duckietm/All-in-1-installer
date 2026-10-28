// Fail before listening if an installation has no valid runtime configuration.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Fraction of the container memory limit V8 is allowed to use for its heap.
 * The rest has to cover native allocations the JS heap cannot account for:
 * the mysql2 pool buffers, sharp's image pipeline, and zlib during a burst of
 * RSC rendering. */
const HEAP_FRACTION = 0.7;
const MIN_HEAP_MB = 512;
/** Backstop only. The fraction is the real policy: on a 6 GB container it asks
 * for 4300 MB, and a backstop at or below that would silently turn the fraction
 * into a fixed number and make the two limits disagree. This exists purely so a
 * nonsensical cgroup reading cannot ask for an unbounded heap. */
const MAX_HEAP_MB = 8192;

export function heapLimitMb(cgroupLimitBytes) {
	if (!Number.isFinite(cgroupLimitBytes) || cgroupLimitBytes <= 0)
		return MAX_HEAP_MB;
	const mb = Math.floor((cgroupLimitBytes * HEAP_FRACTION) / (1024 * 1024));
	return Math.min(MAX_HEAP_MB, Math.max(MIN_HEAP_MB, mb));
}

/**
 * Read this container's memory ceiling from cgroup v2, falling back to v1.
 * Without this the V8 heap defaults to a quarter of *host* memory, so a 4 GB
 * container on a 24 GB host lets the heap grow past the limit and the kernel
 * OOM-kills the process mid-request — which is what produced the
 * `next-build (v16)` kills in the host logs. A container that GCs before it
 * reaches the ceiling degrades to a slower page instead of a killed process.
 */
export function detectMemoryLimitMb(readFile = readFileSync) {
	const candidates = [
		"/sys/fs/cgroup/memory.max",
		"/sys/fs/cgroup/memory/memory.limit_in_bytes",
	];
	for (const path of candidates) {
		let raw;
		try {
			raw = readFile(path, "utf8").trim();
		} catch {
			continue;
		}
		// cgroup v1 reports "max" for an unlimited cgroup; v2 uses a bare
		// sentinel of a very large number on some kernels.
		if (raw === "max" || raw === "") continue;
		const bytes = Number(raw);
		if (!Number.isFinite(bytes) || bytes <= 0) continue;
		// A host-sized "limit" means no cgroup ceiling was applied.
		if (bytes >= Number.MAX_SAFE_INTEGER) continue;
		return heapLimitMb(bytes);
	}
	return heapLimitMb(Number.NaN);
}

export function runtimeNodeOptions(
	existing = "",
	heapMb = detectMemoryLimitMb(),
) {
	const flag = `--max-old-space-size=${heapMb}`;
	if (!existing.trim()) return flag;
	// Respect an explicit operator override; only add the cap when absent.
	if (existing.includes("--max-old-space-size")) return existing;
	return `${existing} ${flag}`;
}

export function validateRuntime(settings) {
	const invalid = [];
	if (!settings.HOTEL_NAME?.trim() || settings.HOTEL_NAME === "Build fixture")
		invalid.push("HOTEL_NAME");
	if (
		!settings.AUTH_SECRET ||
		settings.AUTH_SECRET.length < 32 ||
		settings.AUTH_SECRET.startsWith("build-fixture-")
	)
		invalid.push("AUTH_SECRET");
	for (const [key, protocols] of [
		["DATABASE_URL", ["mysql:"]],
		["APP_URL", ["http:", "https:"]],
	]) {
		try {
			if (!protocols.includes(new URL(settings[key]).protocol))
				invalid.push(key);
		} catch {
			invalid.push(key);
		}
	}
	if (invalid.length)
		throw new Error(`Invalid runtime configuration: ${invalid.join(", ")}`);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		validateRuntime(process.env);
		const heapMb = detectMemoryLimitMb();
		const nodeOptions = runtimeNodeOptions(process.env.NODE_OPTIONS, heapMb);
		console.log(`Starting CMS with a ${heapMb} MB V8 heap cap`);
		const child = spawn(process.execPath, ["server.js"], {
			stdio: "inherit",
			env: { ...process.env, NODE_OPTIONS: nodeOptions },
		});
		for (const signal of ["SIGTERM", "SIGINT"])
			process.on(signal, () => child.kill(signal));
		child.on("error", () => {
			console.error("CMS process could not start");
			process.exitCode = 1;
		});
		child.on("exit", (code) => {
			process.exitCode = code ?? 1;
		});
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
