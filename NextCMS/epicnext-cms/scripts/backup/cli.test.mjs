import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { loadConfig } from "./cli.mjs";

it("does not provide a production restore command or target option", () => {
	for (const args of [
		["restore", "--target", "production"],
		["drill", "--artifact", "/missing", "--target", "production"],
	]) {
		const result = spawnSync(
			process.execPath,
			["scripts/backup/cli.mjs", ...args],
			{ encoding: "utf8" },
		);
		expect(result.status).toBe(1);
		expect(result.stderr).not.toContain("production");
	}
});

it("loads only explicit configuration and refuses to include that configuration in file roots", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "cms-backup-cli-"));
	try {
		const root = path.join(directory, "storage");
		await mkdir(root);
		const config = {
			database: {
				host: "127.0.0.1",
				port: 3306,
				user: "fixture",
				password: "secret-value",
				database: "fixture",
			},
			roots: {
				storage: root,
				nitro: path.join(directory, "nitro"),
				swf: path.join(directory, "swf"),
			},
		};
		const file = path.join(directory, "private.json");
		await writeFile(file, JSON.stringify(config), { mode: 0o600 });
		expect(await loadConfig(file)).toEqual(config);
		const unsafe = path.join(root, "custom-settings.json");
		await writeFile(unsafe, JSON.stringify(config), { mode: 0o600 });
		await expect(loadConfig(unsafe)).rejects.toThrow();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
