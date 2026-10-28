import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createArtifact, restoreFiles, verifyArtifact } from "./core.mjs";

let directory;
let roots;
let output;
const database = { database: "fixture", objects: [], tables: [] };
const dump = async (target) => {
	await writeFile(target, "CREATE DATABASE fixture;\n");
	return database;
};
beforeEach(async () => {
	directory = await mkdtemp(path.join(tmpdir(), "cms-backup-test-"));
	roots = Object.fromEntries(
		["storage", "nitro", "swf"].map((key) => [key, path.join(directory, key)]),
	);
	for (const root of Object.values(roots)) await mkdir(root);
	await mkdir(path.join(roots.storage, "empty"));
	await writeFile(
		path.join(roots.storage, "image.bin"),
		Buffer.from([0, 255, 128, 1]),
	);
	await writeFile(
		path.join(roots.nitro, "furniture.json"),
		'{"caption":"Caffè 🏨"}',
	);
	output = path.join(directory, "artifact");
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

it("copies exact bytes and empty directories, records hashes without source paths, and restores only into a new directory", async () => {
	const manifest = await createArtifact({ roots, output }, dump);
	expect(manifest.complete).toBe(true);
	expect(JSON.stringify(manifest)).not.toContain(directory);
	expect(
		manifest.entries.find((entry) => entry.path === "files/storage/image.bin")
			.sha256,
	).toMatch(/^[a-f0-9]{64}$/);
	expect(await verifyArtifact(output)).toEqual(manifest);
	const restored = path.join(directory, "restored");
	await restoreFiles(output, restored);
	expect(await readFile(path.join(restored, "storage/image.bin"))).toEqual(
		Buffer.from([0, 255, 128, 1]),
	);
	expect(await readdir(path.join(restored, "storage/empty"))).toEqual([]);
	await expect(restoreFiles(output, restored)).rejects.toThrow();
});

it.each(["files/storage/image.bin", "database.sql"])(
	"rejects modified %s before restoring files",
	async (entry) => {
		await createArtifact({ roots, output }, dump);
		await writeFile(path.join(output, entry), "tampered");
		const restored = path.join(directory, "restored");
		await expect(restoreFiles(output, restored)).rejects.toThrow();
		await expect(readdir(restored)).rejects.toThrow();
	},
);

it("rejects unlisted files and malicious manifest traversal", async () => {
	await createArtifact({ roots, output }, dump);
	const extra = path.join(output, "unexpected.txt");
	await writeFile(extra, "extra");
	await expect(verifyArtifact(output)).rejects.toThrow();
	await rm(extra);
	const manifest = JSON.parse(
		await readFile(path.join(output, "manifest.json"), "utf8"),
	);
	manifest.entries[0].path = "../escape";
	await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest));
	await expect(verifyArtifact(output)).rejects.toThrow();
});

it("rejects an incomplete artifact and leaves no final artifact after dump failure", async () => {
	await expect(
		createArtifact({ roots, output }, async () => {
			throw Error("database failed");
		}),
	).rejects.toThrow();
	await expect(readdir(output)).rejects.toThrow();
	await mkdir(output);
	await writeFile(path.join(output, "database.sql"), "partial");
	await expect(verifyArtifact(output)).rejects.toThrow();
});

it("refuses overwrites and output inside a source root", async () => {
	await mkdir(output);
	await writeFile(path.join(output, "keep"), "original");
	await expect(createArtifact({ roots, output }, dump)).rejects.toThrow();
	expect(await readFile(path.join(output, "keep"), "utf8")).toBe("original");
	await expect(
		createArtifact({ roots, output: path.join(roots.storage, "backup") }, dump),
	).rejects.toThrow();
});

it("rejects omitted roots, overlapping roots, and secret configuration files", async () => {
	await expect(
		createArtifact({ roots: { storage: roots.storage }, output }, dump),
	).rejects.toThrow();
	await expect(
		createArtifact({ roots: { ...roots, nitro: roots.storage }, output }, dump),
	).rejects.toThrow();
	await writeFile(path.join(roots.storage, ".env"), "DATABASE_URL=secret");
	await expect(createArtifact({ roots, output }, dump)).rejects.toThrow();
});

it("rejects symbolic links in source trees and artifact trees", async () => {
	const outside = path.join(directory, "outside");
	await mkdir(outside);
	await writeFile(path.join(outside, "secret"), "private");
	const link = path.join(roots.storage, "linked");
	await symlink(
		outside,
		link,
		process.platform === "win32" ? "junction" : "dir",
	);
	await expect(createArtifact({ roots, output }, dump)).rejects.toThrow();
	await rm(link);
	await createArtifact({ roots, output }, dump);
	await symlink(
		outside,
		path.join(output, "files/storage/linked"),
		process.platform === "win32" ? "junction" : "dir",
	);
	await expect(verifyArtifact(output)).rejects.toThrow();
});

it("rejects files changed while the database is being dumped", async () => {
	await expect(
		createArtifact({ roots, output }, async (target) => {
			await writeFile(
				path.join(roots.storage, "image.bin"),
				"changed during backup",
			);
			return dump(target);
		}),
	).rejects.toThrow();
	await expect(readdir(output)).rejects.toThrow();
});

it("restores a directory whose prefix also appears in a sibling filename", async () => {
	await mkdir(path.join(roots.storage, "foo"));
	await writeFile(path.join(roots.storage, "foo/file"), "nested");
	await writeFile(path.join(roots.storage, "foo.json"), "sibling");
	await createArtifact({ roots, output }, dump);
	const destination = path.join(directory, "restored");
	await restoreFiles(output, destination);
	expect(
		await readFile(path.join(destination, "storage/foo/file"), "utf8"),
	).toBe("nested");
	expect(
		await readFile(path.join(destination, "storage/foo.json"), "utf8"),
	).toBe("sibling");
});
