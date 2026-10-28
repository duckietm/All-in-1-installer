import { promises as fs } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import {
	catalogGitEnvironment,
	readManagedCatalogConfig,
} from "./catalog-git-config";
import {
	CATALOG_BRANCH,
	CATALOG_REMOTE,
	publishCatalogFiles,
	recoverCatalogQueue,
} from "./catalog-git-core";
import { ensureManagedCatalogCheckout } from "./catalog-git-managed";
import { catalogExportEnabled, catalogExportQueue } from "./catalog-git-queue";
import { createCatalogSnapshot } from "./catalog-git-snapshot";

export async function runCatalogExport() {
	if (!catalogExportEnabled()) return;
	const queue = catalogExportQueue();
	await queue.entries();
	await recoverCatalogQueue(queue.root);
	const lock = await fs
		.open(path.join(queue.root, "worker.lock"), "wx")
		.catch((error: NodeJS.ErrnoException) => {
			if (error.code === "EEXIST") return null;
			throw error;
		});
	if (!lock) return;
	let snapshot: string | undefined;
	const status = async (value: Record<string, unknown>) => {
		const temp = path.join(queue.root, "status.tmp");
		let previous: Record<string, unknown> = {};
		try {
			previous = JSON.parse(
				await fs.readFile(path.join(queue.root, "status.json"), "utf8"),
			);
		} catch {
			/* First attempt. */
		}
		await fs.writeFile(
			temp,
			JSON.stringify({ ...previous, error: undefined, ...value }),
		);
		await fs.rename(temp, path.join(queue.root, "status.json"));
	};
	try {
		await lock.writeFile(
			JSON.stringify({ pid: process.pid, host: hostname() }),
		);
		const batch = await queue.batch();
		if (!batch?.length) return;
		snapshot = await fs.mkdtemp(path.join(queue.root, "snapshot-"));
		const files = await createCatalogSnapshot(snapshot);
		// Any operation started/completed during capture invalidates the snapshot.
		const current = await queue.batch();
		if (!current || JSON.stringify(current) !== JSON.stringify(batch)) return;
		const config = readManagedCatalogConfig();
		if (config && !config.enabled) return;
		const checkout = config
			? await ensureManagedCatalogCheckout(config)
			: process.env.CATALOG_GIT_CHECKOUT?.trim();
		if (!checkout) return;
		const commit = await publishCatalogFiles({
			checkout,
			remote: config?.remote ?? CATALOG_REMOTE,
			branch: config?.branch ?? CATALOG_BRANCH,
			env: config ? catalogGitEnvironment(config) : undefined,
			files,
		});
		await queue.complete(batch);
		await status({ commit, finishedAt: new Date().toISOString() });
	} catch {
		// Do not expose credentials or Git stderr through the admin API.
		await status({
			error:
				"Export failed. Check repository access, branch, clean checkout and asset/database availability. Pending changes will be retried.",
			finishedAt: new Date().toISOString(),
		});
	} finally {
		try {
			if (
				snapshot &&
				path.resolve(snapshot).startsWith(path.resolve(queue.root) + path.sep)
			) {
				await fs.rm(snapshot, { recursive: true, force: true });
			}
		} finally {
			await lock.close();
			await fs.rm(path.join(queue.root, "worker.lock"), { force: true });
		}
	}
}
