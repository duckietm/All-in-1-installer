import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { safeDirectory } from "./core.mjs";
import { createBackup, drillBackup, validateDatabase } from "./database.mjs";

export async function loadConfig(file) {
	if (!path.isAbsolute(file)) throw Error("Use an absolute configuration path");
	await safeDirectory(path.dirname(file));
	const stat = await lstat(file);
	if (
		!stat.isFile() ||
		stat.isSymbolicLink() ||
		stat.nlink !== 1 ||
		(process.platform !== "win32" && stat.mode & 0o077)
	)
		throw Error("Configuration must be a private regular file");
	const config = JSON.parse(await readFile(file, "utf8"));
	if (
		Object.keys(config).some((key) => !["database", "roots"].includes(key)) ||
		!config.roots
	)
		throw Error("Invalid backup configuration");
	validateDatabase(config.database);
	for (const root of Object.values(config.roots)) {
		if (typeof root !== "string" || !path.isAbsolute(root))
			throw Error("Use absolute source paths");
		const relative = path.relative(path.resolve(root), file);
		if (
			!relative ||
			(!relative.startsWith(`..${path.sep}`) &&
				relative !== ".." &&
				!path.isAbsolute(relative))
		)
			throw Error("Keep the configuration outside every source root");
	}
	return config;
}

export async function main(args = process.argv.slice(2)) {
	const [command, ...options] = args;
	if (!["create", "drill"].includes(command))
		throw Error("Choose create or drill");
	const schema =
		command === "create"
			? {
					config: { type: "string" },
					output: { type: "string" },
					"writers-quiesced": { type: "boolean" },
				}
			: { artifact: { type: "string" } };
	const { values } = parseArgs({
		args: options,
		options: schema,
		strict: true,
		allowPositionals: false,
	});
	if (command === "create") {
		if (
			!values.config ||
			!values.output ||
			values["writers-quiesced"] !== true ||
			process.platform !== "linux"
		)
			throw Error("Create requires Linux, explicit paths and paused writers");
		const config = await loadConfig(values.config);
		await createBackup({
			...config,
			output: values.output,
			writersQuiesced: true,
		});
		process.stdout.write(
			"Backup created and checksums verified. Run the isolated drill before relying on it.\n",
		);
	} else {
		if (!values.artifact) throw Error("Provide an artifact");
		await drillBackup({ artifact: values.artifact });
		process.stdout.write(
			"Isolated restore verified; disposable database and files removed.\n",
		);
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
	main().catch(() => {
		process.stderr.write(
			"Backup command failed. Check private configuration, prerequisites, paused writers and artifact integrity. No server output was logged.\n",
		);
		process.exitCode = 1;
	});
}
