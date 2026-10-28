import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
	catalogGitEnvironment,
	type ManagedCatalogConfig,
	managedCatalogCheckout,
} from "./catalog-git-config";

const exec = promisify(execFile);
export async function testCatalogConnection(config: ManagedCatalogConfig) {
	try {
		const result = await exec(
			"git",
			[
				"ls-remote",
				"--exit-code",
				"--heads",
				config.remote,
				`refs/heads/${config.branch}`,
			],
			{
				env: catalogGitEnvironment(config),
				timeout: 30000,
				maxBuffer: 1024 * 1024,
			},
		);
		if (!result.stdout.trim()) throw new Error("Missing branch");
	} catch {
		throw new Error(
			"Cannot read this Gitea repository and branch. Check the URL, username, token and server Git installation.",
		);
	}
}
export async function ensureManagedCatalogCheckout(
	config: ManagedCatalogConfig,
) {
	const checkout = managedCatalogCheckout(config);
	try {
		await fs.access(path.join(checkout, ".git"));
		return checkout;
	} catch {
		/* first export */
	}
	await fs.mkdir(path.dirname(checkout), { recursive: true });
	const temporary = `${checkout}.clone-${randomUUID()}`;
	try {
		await exec(
			"git",
			[
				"clone",
				"--single-branch",
				"--branch",
				config.branch,
				"--",
				config.remote,
				temporary,
			],
			{
				env: catalogGitEnvironment(config),
				timeout: 600000,
				maxBuffer: 4 * 1024 * 1024,
			},
		);
		await fs.rename(temporary, checkout);
		return checkout;
	} finally {
		await fs.rm(temporary, { recursive: true, force: true });
	}
}
