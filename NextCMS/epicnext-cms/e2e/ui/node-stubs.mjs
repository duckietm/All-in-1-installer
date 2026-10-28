// Stubs for Node.js built-ins used by server-only modules that leak into the
// UI fixture bundle. These keep esbuild from failing on `node:*` imports
// while providing shape-compatible exports so the bundle stays loadable.
// Nothing here performs real I/O; it only exists so module evaluation in the
// browser does not crash on import of server-only helpers.

export class AsyncLocalStorage {
	enterWith() {}
	exit() {}
	getStore() {
		return undefined;
	}
	run(_store, work) {
		return work();
	}
}

const cryptoApi = {
	createHash: () => ({
		update: () => ({
			digest: () => "",
		}),
	}),
	randomUUID: () => "00000000-0000-0000-0000-000000000000",
	randomBytes: (size) => new Uint8Array(size),
	createHmac: () => ({
		update: () => ({
			digest: () => "",
		}),
	}),
	timingSafeEqual: () => true,
	createCipheriv: () => ({
		update: () => new Uint8Array(0),
		final: () => new Uint8Array(0),
	}),
	createDecipheriv: () => ({
		update: () => new Uint8Array(0),
		final: () => new Uint8Array(0),
	}),
	webcrypto: globalThis.crypto,
};

export const {
	createHash,
	randomUUID,
	randomBytes,
	createHmac,
	timingSafeEqual,
	createCipheriv,
	createDecipheriv,
	webcrypto,
} = cryptoApi;

export const appendFile = async () => {};
export const mkdir = async () => {};
export const readdir = async () => [];
export const readFile = async () => new Uint8Array(0);
export const rename = async () => {};
export const stat = async () => ({
	isDirectory: () => false,
	isFile: () => true,
	size: 0,
	mtimeMs: 0,
});
export const unlink = async () => {};
export const writeFile = async () => {};
export const rm = async () => {};
export const mkdtemp = async () => "/tmp/fixture-stub";

export const promises = {
	appendFile,
	mkdir,
	readdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
	rm,
	mkdtemp,
};

export const existsSync = () => false;
export const readFileSync = () => new Uint8Array(0);
export const writeFileSync = () => {};
export const readdirSync = () => [];
export const mkdirSync = () => {};
export const rmSync = () => {};
export const mkdtempSync = () => "/tmp/fixture-stub";
export const appendFileSync = () => {};
export const statSync = () => ({
	isDirectory: () => false,
	isFile: () => true,
	size: 0,
});

const pathApi = {
	join: (...parts) => parts.join("/"),
	resolve: (...parts) => parts.join("/"),
	dirname: (value) => value.split("/").slice(0, -1).join("/"),
	basename: (value) => value.split("/").pop() ?? "",
	extname: (value) => {
		const base = value.split("/").pop() ?? "";
		const index = base.lastIndexOf(".");
		return index > 0 ? base.slice(index) : "";
	},
	relative: (_from, to) => to,
	normalize: (value) => value,
	isAbsolute: (value) => value.startsWith("/"),
	sep: "/",
	delimiter: ":",
};

export const {
	join,
	resolve,
	dirname,
	basename,
	extname,
	relative,
	normalize,
	isAbsolute,
	sep,
	delimiter,
} = pathApi;

export const path = pathApi;

const osApi = {
	hostname: () => "localhost",
	tmpdir: () => "/tmp",
	platform: () => "linux",
	homedir: () => "/tmp",
};

export const { hostname, tmpdir, platform, homedir } = osApi;

export const promisify = (fn) => fn;
export const isIP = () => 0;
export const lookup = async () => ({ address: "127.0.0.1", family: 4 });
export const execFile = () => {};
export const execFileSync = () => "";
export const spawnSync = () => ({ status: 0, stdout: "", stderr: "" });
export const fileURLToPath = (value) => String(value);
export const createServer = () => ({
	listen: () => {},
	close: () => {},
	on: () => {},
	address: () => ({ port: 0 }),
});

// Single default export: all node:* aliases point at this one file, and the
// merged object keeps `import crypto from "node:crypto"`, `import path from
// "node:path"` and `import os from "node:os"` usable after aliasing.
export default {
	...cryptoApi,
	...pathApi,
	...osApi,
	appendFile,
	mkdir,
	readdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
	rm,
	mkdtemp,
	promises,
	existsSync,
	readFileSync,
	writeFileSync,
	readdirSync,
	mkdirSync,
	rmSync,
	mkdtempSync,
	appendFileSync,
	statSync,
	promisify,
	isIP,
	lookup,
	execFile,
	execFileSync,
	spawnSync,
	fileURLToPath,
	createServer,
};
