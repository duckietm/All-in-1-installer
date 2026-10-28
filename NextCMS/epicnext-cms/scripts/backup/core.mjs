import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";

const requiredRoots = ["storage", "nitro", "swf"];
const allowedRoots = [...requiredRoots, "gamedata"];
const fail = () => {
	throw Error("Backup file validation failed");
};
const sortedEntries = (entries) =>
	[...entries].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
	);
const inside = (parent, child) => {
	const relative = path.relative(parent, child);
	return (
		!relative ||
		(!relative.startsWith(`..${path.sep}`) &&
			relative !== ".." &&
			!path.isAbsolute(relative))
	);
};

export async function safeDirectory(value) {
	if (
		typeof value !== "string" ||
		!path.isAbsolute(value) ||
		value.split(/[\\/]/).includes("..")
	)
		fail();
	const resolved = path.resolve(value);
	if (resolved === path.parse(resolved).root) fail();
	for (
		let current = resolved;
		current !== path.dirname(current);
		current = path.dirname(current)
	) {
		const stat = await lstat(current);
		if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
	}
	return resolved;
}

function validEntry(entry, roots) {
	const name = entry.path;
	if (
		typeof name !== "string" ||
		/[\\:]/.test(name) ||
		[...name].some((character) => character.charCodeAt(0) < 32) ||
		name.split("/").some((part) => !part || part === "." || part === "..")
	)
		fail();
	if (
		name !== "database.sql" &&
		name !== "files" &&
		!roots.some(
			(root) => name === `files/${root}` || name.startsWith(`files/${root}/`),
		)
	)
		fail();
	if (!["file", "directory"].includes(entry.type)) fail();
	if (
		entry.type === "file" &&
		(!Number.isSafeInteger(entry.bytes) ||
			entry.bytes < 0 ||
			!/^[a-f0-9]{64}$/.test(entry.sha256))
	)
		fail();
}

async function transfer(source, target) {
	const before = await lstat(source);
	if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail();
	const input = await open(
		source,
		constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
	);
	let output;
	try {
		const opened = await input.stat();
		if (opened.dev !== before.dev || opened.ino !== before.ino) fail();
		if (target) output = await open(target, "wx", 0o600);
		const hash = createHash("sha256");
		let bytes = 0;
		for await (const chunk of input.createReadStream({ autoClose: false })) {
			hash.update(chunk);
			bytes += chunk.length;
			if (output) await output.writeFile(chunk);
		}
		const after = await input.stat();
		if (
			before.size !== bytes ||
			after.size !== before.size ||
			after.mtimeMs !== before.mtimeMs ||
			after.ctimeMs !== before.ctimeMs
		)
			fail();
		return { bytes, sha256: hash.digest("hex") };
	} finally {
		await input.close();
		await output?.close();
	}
}

async function walk(directory, prefix, destination, rejectSecrets = false) {
	await safeDirectory(directory);
	const entries = [{ path: prefix, type: "directory" }];
	for (const name of (await readdir(directory)).sort()) {
		if (
			rejectSecrets &&
			(/^\.env(?:\.|$)/i.test(name) ||
				[".docker-install", "persistent.path", "backup.config.json"].includes(
					name,
				))
		)
			fail();
		const source = path.join(directory, name);
		const relative = `${prefix}/${name}`;
		const stat = await lstat(source);
		if (stat.isSymbolicLink()) fail();
		if (stat.isDirectory()) {
			if (destination)
				await mkdir(path.join(destination, name), { mode: 0o700 });
			entries.push(
				...(await walk(
					source,
					relative,
					destination && path.join(destination, name),
					rejectSecrets,
				)),
			);
		} else {
			const content = await transfer(
				source,
				destination && path.join(destination, name),
			);
			entries.push({ path: relative, type: "file", ...content });
		}
	}
	return entries;
}

export async function createArtifact({ roots, output }, writeDatabase) {
	if (
		!roots ||
		requiredRoots.some((key) => !roots[key]) ||
		Object.keys(roots).some((key) => !allowedRoots.includes(key))
	)
		fail();
	const sources = await Promise.all(Object.values(roots).map(safeDirectory));
	if (!path.isAbsolute(output) || output.split(/[\\/]/).includes("..")) fail();
	output = path.join(
		await safeDirectory(path.dirname(output)),
		path.basename(output),
	);
	for (let index = 0; index < sources.length; index++) {
		if (
			inside(sources[index], output) ||
			inside(output, sources[index]) ||
			sources.some(
				(source, other) =>
					other !== index &&
					(inside(source, sources[index]) || inside(sources[index], source)),
			)
		)
			fail();
	}
	await mkdir(output, { mode: 0o700 }); // Exclusive reservation; never replace an existing artifact.
	try {
		await mkdir(path.join(output, "files"), { mode: 0o700 });
		const entries = [{ path: "files", type: "directory" }];
		for (const key of Object.keys(roots).sort()) {
			const destination = path.join(output, "files", key);
			await mkdir(destination, { mode: 0o700 });
			entries.push(
				...(await walk(roots[key], `files/${key}`, destination, true)),
			);
		}
		const database = await writeDatabase(path.join(output, "database.sql"));
		const sql = await transfer(path.join(output, "database.sql"));
		if (!sql.bytes) fail();
		entries.push({ path: "database.sql", type: "file", ...sql });
		// Detect source changes across the database dump and the file copy interval.
		for (const key of Object.keys(roots)) {
			const current = await walk(roots[key], `files/${key}`, undefined, true);
			if (
				JSON.stringify(current) !==
				JSON.stringify(
					entries.filter(
						(entry) =>
							entry.path === `files/${key}` ||
							entry.path.startsWith(`files/${key}/`),
					),
				)
			)
				fail();
		}
		entries.sort((left, right) =>
			left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
		);
		const manifest = {
			format: 1,
			complete: true,
			createdAt: new Date().toISOString(),
			roots: Object.keys(roots).sort(),
			database,
			entries,
		};
		for (const entry of entries) validEntry(entry, manifest.roots);
		await writeFile(
			path.join(output, "manifest.json"),
			`${JSON.stringify(manifest, null, 2)}\n`,
			{ flag: "wx", mode: 0o600 },
		);
		await verifyArtifact(output);
		return manifest;
	} catch (error) {
		await rm(output, { recursive: true, force: true });
		throw error;
	}
}

export async function verifyArtifact(directory) {
	await safeDirectory(directory);
	const manifestPath = path.join(directory, "manifest.json");
	await transfer(manifestPath); // Reject links before parsing the manifest.
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	if (
		manifest.format !== 1 ||
		manifest.complete !== true ||
		!Array.isArray(manifest.roots) ||
		requiredRoots.some((root) => !manifest.roots.includes(root)) ||
		manifest.roots.some((root) => !allowedRoots.includes(root)) ||
		!Array.isArray(manifest.entries)
	)
		fail();
	const names = new Set();
	for (const entry of manifest.entries) {
		validEntry(entry, manifest.roots);
		if (names.has(entry.path)) fail();
		names.add(entry.path);
	}
	if (
		!manifest.entries.some(
			(entry) =>
				entry.path === "database.sql" &&
				entry.type === "file" &&
				entry.bytes > 0,
		)
	)
		fail();
	const actual = (await walk(directory, "artifact"))
		.filter(
			(entry) =>
				entry.path !== "artifact" && entry.path !== "artifact/manifest.json",
		)
		.map((entry) => ({ ...entry, path: entry.path.slice(9) }));
	if (
		JSON.stringify(sortedEntries(actual)) !==
		JSON.stringify(sortedEntries(manifest.entries))
	)
		fail();
	for (const root of manifest.roots)
		if (
			!actual.some(
				(entry) => entry.path === `files/${root}` && entry.type === "directory",
			)
		)
			fail();
	return manifest;
}

export async function restoreFiles(artifact, destination) {
	const manifest = await verifyArtifact(artifact);
	if (
		!path.isAbsolute(destination) ||
		inside(path.resolve(artifact), path.resolve(destination))
	)
		fail();
	await safeDirectory(path.dirname(destination));
	await mkdir(destination, { mode: 0o700 });
	try {
		for (const root of manifest.roots) {
			const target = path.join(destination, root);
			await mkdir(target, { mode: 0o700 });
			const entries = await walk(
				path.join(artifact, "files", root),
				`files/${root}`,
				target,
			);
			const expectedEntries = manifest.entries.filter(
				(entry) =>
					entry.path === `files/${root}` ||
					entry.path.startsWith(`files/${root}/`),
			);
			if (
				JSON.stringify(sortedEntries(entries)) !==
				JSON.stringify(sortedEntries(expectedEntries))
			)
				fail();
		}
	} catch (error) {
		await rm(destination, { recursive: true, force: true });
		throw error;
	}
	return manifest;
}
