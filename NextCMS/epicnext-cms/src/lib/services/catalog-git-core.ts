import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
	digestFile,
	type FileDigest,
	verifyStagedRelease,
} from "@/features/catalog/releases/files";
import {
	CATALOG_RELEASE_MANIFEST_PATH,
	type ReleaseManifest,
	validateReleaseManifest,
} from "@/features/catalog/releases/manifest";
import { gitProcessEnvironment } from "./git-process-environment";

const exec = promisify(execFile);
export const CATALOG_REMOTE =
	"https://gitlab.epicnabbo.nl/remco/Epicnabbo-Catalogus-Updated-Daily.git";
export const CATALOG_BRANCH = "Beta-3";
export const CATALOG_SQL_ROOT = "catalogue version 2 ( Final (Dev)/sqls";
export const CATALOG_LANGUAGE_ROOT =
	"catalogue version 2 ( Final (Dev)/langs furnidata";

export class CatalogExportQueue {
	constructor(readonly root: string) {}
	async entries() {
		await fs.mkdir(this.root, { recursive: true });
		return (await fs.readdir(this.root)).sort();
	}
	async begin() {
		await this.entries();
		const id = randomUUID();
		await fs.writeFile(
			path.join(this.root, `${id}.active`),
			JSON.stringify({
				pid: process.pid,
				host: hostname(),
				startedAt: new Date().toISOString(),
			}),
			{ flag: "wx" },
		);
		let finished = false;
		return async () => {
			if (finished) return;
			await fs.rename(
				path.join(this.root, `${id}.active`),
				path.join(this.root, `${id}.pending`),
			);
			finished = true;
		};
	}
	async request() {
		await (await this.begin())();
	}
	async batch(): Promise<string[] | null> {
		const entries = await this.entries();
		if (entries.some((f) => f.endsWith(".active"))) return null;
		return entries.filter((f) => f.endsWith(".pending"));
	}
	async complete(batch: string[]) {
		for (const file of batch) {
			if (!/^[a-f0-9-]+\.pending$/.test(file))
				throw new Error("Invalid queue entry");
			await fs.rm(path.join(this.root, file), { force: true });
		}
	}
}

export function sqlValue(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Invalid SQL number");
		return String(value);
	}
	if (typeof value === "bigint") return String(value);
	if (typeof value === "boolean") return value ? "1" : "0";
	if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
	const text =
		value instanceof Date
			? value.toISOString().slice(0, 23).replace("T", " ")
			: String(value);
	return text.length
		? `CONVERT(X'${Buffer.from(text, "utf8").toString("hex")}' USING utf8mb4)`
		: "''";
}

export interface CatalogFile {
	source: string;
	target: string;
}

export function catalogTarget(root: string, target: string) {
	if (
		target.includes("\\") ||
		target.split("/").some((s) => s === ".." || s === ".git") ||
		path.isAbsolute(target)
	) {
		throw new Error("Invalid catalog target");
	}
	const result = path.resolve(root, target);
	if (!result.startsWith(`${path.resolve(root)}${path.sep}`))
		throw new Error("Invalid catalog target");
	if (
		!target.startsWith("Gamedata/") &&
		!target.startsWith(`${CATALOG_SQL_ROOT}/`) &&
		!target.startsWith(`${CATALOG_LANGUAGE_ROOT}/`)
	) {
		throw new Error("Unmanaged catalog target");
	}
	return result;
}

export async function publishCatalogFiles(options: {
	checkout: string;
	remote: string;
	branch: string;
	files: CatalogFile[];
	env?: NodeJS.ProcessEnv;
}) {
	const { checkout, remote, branch, files } = options;
	const git = async (...args: string[]) => {
		const { stdout } = await exec("git", args, {
			cwd: checkout,
			timeout: 120_000,
			maxBuffer: (args.includes("ls-files") ? 128 : 16) * 1024 * 1024,
			env: {
				...gitProcessEnvironment(),
				...options.env,
				GIT_TERMINAL_PROMPT: "0",
			},
		});
		return args.includes("-z") ? stdout : stdout.trim();
	};
	for (const file of files) catalogTarget(checkout, file.target);
	if ((await git("remote", "get-url", "origin")) !== remote)
		throw new Error("Unexpected catalog origin");
	if ((await git("branch", "--show-current")) !== branch)
		throw new Error("Unexpected catalog branch");
	if (await git("status", "--porcelain"))
		throw new Error("Catalog checkout must be clean");
	try {
		await git("pull", "--rebase", "origin", branch);
	} catch (error) {
		await git("rebase", "--abort").catch(() => undefined);
		throw error;
	}
	const created: string[] = [];
	let committed = false;
	try {
		for (const file of files) {
			const target = catalogTarget(checkout, file.target);
			// Reject symlink ancestors, including the target itself.
			let ancestor = target;
			while (ancestor !== path.resolve(checkout)) {
				const stat = await fs
					.lstat(ancestor)
					.catch((error: NodeJS.ErrnoException) => {
						if (error.code === "ENOENT") return null;
						throw error;
					});
				if (stat?.isSymbolicLink())
					throw new Error("Symlink in catalog target");
				ancestor = path.dirname(ancestor);
			}
			const exists = await fs.stat(target).then(
				() => true,
				() => false,
			);
			if (!exists) created.push(target);
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.copyFile(file.source, target);
		}
		// Only explicitly exported paths are eligible for staging.
		for (let i = 0; i < files.length; i += 50) {
			await git(
				"--literal-pathspecs",
				"add",
				"--",
				...files.slice(i, i + 50).map((f) => f.target),
			);
		}
		// Validate the actual index objects, including transformations by Git filters.
		const manifestFile = files.find(
			(file) => file.target === CATALOG_RELEASE_MANIFEST_PATH,
		);
		if (manifestFile) {
			const manifest: ReleaseManifest = JSON.parse(
				await fs.readFile(manifestFile.source, "utf8"),
			);
			const expected = new Map<string, FileDigest>();
			for (const file of files) {
				if (expected.has(file.target))
					throw new Error("Duplicate catalog target");
				expected.set(file.target, await digestFile(file.source));
			}
			if (manifest.files.length !== files.length - 1)
				throw new Error("Catalog release file set mismatch");
			await validateReleaseManifest(manifest, async (target) => {
				const digest = expected.get(target);
				if (!digest) throw new Error("Catalog release file set mismatch");
				return digest;
			});
			verifyStagedRelease(
				await git("ls-files", "--stage", "-z"),
				await git("rev-parse", "--show-object-format"),
				expected,
			);
		}
		if (await git("diff", "--cached", "--name-only")) {
			await git(
				"-c",
				"user.name=Catalog Studio",
				"-c",
				"user.email=catalog-studio@epicnabbo.nl",
				"commit",
				"-m",
				"Update catalog assets and SQL from Catalog Studio",
			);
		}
		committed = true;
		// Also retries commits retained after a previous failed push.
		await git("push", "origin", `HEAD:refs/heads/${branch}`);
		return await git("rev-parse", "HEAD");
	} catch (error) {
		if (!committed) {
			// The checkout was clean at entry; restore only this attempt's changes.
			await git("restore", "--staged", "--worktree", ".");
			for (const file of created) await fs.rm(file, { force: true });
		}
		throw error;
	}
}

export async function recoverCatalogQueue(root: string) {
	for (const name of await fs.readdir(root)) {
		if (!name.endsWith(".active") && name !== "worker.lock") continue;
		const file = path.join(root, name);
		let owner: { pid: number; host: string };
		try {
			owner = JSON.parse(await fs.readFile(file, "utf8"));
		} catch {
			continue;
		}
		if (
			owner.host !== hostname() ||
			!Number.isInteger(owner.pid) ||
			owner.pid <= 0
		)
			continue;
		try {
			process.kill(owner.pid, 0);
			continue;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
		}
		// Recheck ownership before recovering a dead process's entry.
		if (
			(await fs.readFile(file, "utf8").catch(() => "")) !==
			JSON.stringify(owner)
		)
			continue;
		if (name === "worker.lock") await fs.rm(file, { force: true });
		else
			await fs
				.rename(file, path.join(root, name.replace(/\.active$/, ".pending")))
				.catch((error: NodeJS.ErrnoException) => {
					if (error.code !== "ENOENT") throw error;
				});
	}
}
