// Minimal `process` shim injected into the UI fixture bundle. Server-only
// modules that leak into the bundle reference the `process` global at module
// scope (release ids, paths, etc). esbuild's `inject` rewrites those free
// identifier references to import from this file so evaluation cannot crash
// in the browser.

export const process = {
	env: { NODE_ENV: "production" },
	platform: "linux",
	arch: "x64",
	version: "v20.0.0",
	versions: { node: "20.0.0" },
	argv: [],
	cwd: () => "/",
	nextTick: (fn, ...args) => setTimeout(() => fn(...args), 0),
	on: () => {},
	once: () => {},
	emit: () => {},
	exit: () => {},
	hrtime: Object.assign(() => [0, 0], { bigint: () => 0n }),
	memoryUsage: () => ({ heapUsed: 0, rss: 0 }),
	pid: 0,
};

export default process;
