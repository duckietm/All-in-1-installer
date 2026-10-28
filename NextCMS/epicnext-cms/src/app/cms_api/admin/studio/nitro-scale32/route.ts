import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import {
	bundleWritePathInDir,
	resolveBundleInDir,
} from "@/lib/furni/bundle-file";
import { generateScale32 } from "@/lib/furni/nitro-scale32";
import { validateClassnames } from "@/lib/furni/studio-inspection";
import { PERMS } from "@/lib/permission-slugs";
import { withCatalogExport } from "@/lib/services/catalog-git-queue";
import { getFurniAssetDirs } from "@/lib/services/furni-asset-dirs";
import { withFurniDataLock } from "@/lib/services/furni-data";
import { parseNitroBundle } from "@/lib/services/swf/nitro-builder";

const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const body = await request.json();
		if (
			!validateClassnames([body.classname]) ||
			!["preview", "apply", "restore"].includes(body.action)
		)
			return apiError("Invalid request", 400);
		if (
			body.action !== "preview" &&
			!/^[a-f0-9]{64}$/.test(body.expectedHash || "")
		)
			return apiError("Preview the current bundle first", 400);
		if (
			body.action === "restore" &&
			!/^[a-f0-9]{64}$/.test(body.backupHash || "")
		)
			return apiError("Invalid backup", 400);
		const { nitroDir } = await getFurniAssetDirs(),
			base = body.classname.split("*")[0],
			// Edits are written back in place, so the file keeps whatever
			// extension it already has. The `.hab` fallback only exists so a
			// missing bundle still surfaces as the usual ENOENT 422.
			file =
				resolveBundleInDir(/*turbopackIgnore: true*/ nitroDir, base) ??
				bundleWritePathInDir(/*turbopackIgnore: true*/ nitroDir, base);
		const execute = () =>
			withFurniDataLock(async () => {
				const original = await fs.readFile(file),
					originalHash = hash(original);
				if (body.action !== "preview" && originalHash !== body.expectedHash)
					return apiError(
						"The bundle changed. Reopen the editor and preview again.",
						409,
					);
				const backupDir = path.join(
					process.cwd(),
					"storage",
					"nitro-scale32-backups",
				);
				if (body.action === "restore") {
					const backup = await fs.readFile(
						path.join(backupDir, `${base}.${body.backupHash}.nitro`),
					);
					if (hash(backup) !== body.backupHash)
						return apiError("Backup integrity check failed", 422);
					const temp = `${file}.${randomUUID()}.tmp`;
					try {
						await fs.writeFile(temp, backup, { flag: "wx" });
						await fs.rename(temp, file);
					} finally {
						await fs.rm(temp, { force: true });
					}
					return apiOk({
						hash: hash(backup),
						metadata: parseNitroBundle(backup).json,
					});
				}
				const generated = await generateScale32(original);
				if (body.action === "preview")
					return apiOk({
						hash: originalHash,
						before: generated.before,
						after: generated.after,
						count: generated.count,
						skipped: generated.skipped,
					});
				await fs.mkdir(backupDir, { recursive: true });
				const backupFile = path.join(
					backupDir,
					`${base}.${originalHash}.nitro`,
				);
				try {
					await fs.writeFile(backupFile, original, { flag: "wx" });
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
					if (hash(await fs.readFile(backupFile)) !== originalHash)
						throw Error("Backup integrity check failed");
				}
				const temp = `${file}.${randomUUID()}.tmp`;
				try {
					await fs.writeFile(temp, generated.bundle, { flag: "wx" });
					await fs.rename(temp, file);
				} finally {
					await fs.rm(temp, { force: true });
				}
				return apiOk({
					hash: hash(generated.bundle),
					backupHash: originalHash,
					metadata: parseNitroBundle(generated.bundle).json,
					skipped: generated.skipped,
				});
			});
		try {
			return await (body.action === "preview"
				? execute()
				: withCatalogExport(execute));
		} catch (error) {
			return apiError(
				(error as NodeJS.ErrnoException).code === "ENOENT"
					? "Bundle or backup not found"
					: error instanceof Error
						? error.message
						: "Scale generation failed",
				422,
			);
		}
	},
);
