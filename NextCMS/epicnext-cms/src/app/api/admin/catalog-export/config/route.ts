import { promises as fs } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permission-slugs";
import {
	catalogStateRoot,
	publicCatalogConfig,
	readManagedCatalogConfig,
	saveCatalogConfig,
	validateCatalogConfig,
} from "@/lib/services/catalog-git-config";
import { testCatalogConnection } from "@/lib/services/catalog-git-managed";
export const GET = withAdmin({ permission: PERMS.SETTINGS_EDIT }, async () =>
	apiOk(publicCatalogConfig()),
);
export const POST = withAdmin(
	{ permission: PERMS.SETTINGS_EDIT },
	async (request) => {
		const body = await request.json().catch(() => null);
		if (!body || !["save", "test"].includes(body.action))
			return apiError("Choose save or test", 400);
		let config: ReturnType<typeof validateCatalogConfig>;
		try {
			config = validateCatalogConfig(body, readManagedCatalogConfig());
		} catch (error) {
			return apiError((error as Error).message, 400);
		}
		if (body.action === "test") {
			try {
				await testCatalogConnection(config);
				return apiOk({
					message:
						"Gitea repository and branch are readable. Write access is checked when exporting.",
				});
			} catch (error) {
				return apiError((error as Error).message, 400);
			}
		}
		const root = catalogStateRoot();
		await fs.mkdir(root, { recursive: true });
		const lock = await fs
			.open(path.join(root, "worker.lock"), "wx")
			.catch((error: NodeJS.ErrnoException) => {
				if (error.code === "EEXIST") return null;
				throw error;
			});
		if (!lock)
			return apiError("An export is running. Retry after it finishes.", 409);
		try {
			await lock.writeFile(
				JSON.stringify({ pid: process.pid, host: hostname() }),
			);
			const entries = await fs.readdir(root);
			if (entries.some((name) => name.endsWith(".active")))
				return apiError(
					"Wait for active catalog operations to finish before changing Git configuration.",
					409,
				);
			const previous = readManagedCatalogConfig();
			if (
				previous &&
				(previous.remote !== config.remote ||
					previous.branch !== config.branch) &&
				entries.some((name) => name.endsWith(".pending"))
			)
				return apiError(
					"Export pending updates before changing repository or branch.",
					409,
				);
			if (config.enabled) {
				try {
					await testCatalogConnection(config);
				} catch (error) {
					return apiError((error as Error).message, 400);
				}
			}
			await saveCatalogConfig(config);
			if (
				previous &&
				(previous.remote !== config.remote || previous.branch !== config.branch)
			)
				await fs.rm(path.join(root, "status.json"), { force: true });
			return apiOk(publicCatalogConfig(config));
		} finally {
			await lock.close();
			await fs.rm(path.join(root, "worker.lock"), { force: true });
		}
	},
);
