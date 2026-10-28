import { furnitureHealth } from "@/lib/furni/studio-inspection";
import { importSingleFurni } from "./furni-import";
import { inspectFurniture } from "./furniture-inspection";
export async function repairFurniture(
	params: Parameters<typeof importSingleFurni>[0],
): ReturnType<typeof importSingleFurni> {
	const [before] = await inspectFurniture([params.classname]);
	const health = furnitureHealth(before);
	if (health.state === "conflict" || health.state === "unknown")
		throw Error(
			"Repair blocked: local data is conflicting or could not be verified",
		);
	if (health.state === "complete")
		return {
			ok: true,
			itemId: before.sql[0].id,
			warnings: ["Already complete; no changes made"],
		};
	const result = await importSingleFurni({
		...params,
		id: before.sql[0]?.spriteId ?? before.furnidata[0]?.id ?? params.id,
		repairExisting: true,
		preserveAssets: true,
		skipFurniDataWrite: before.furnidata.length > 0,
	});
	if (!result.ok) return result;
	const [after] = await inspectFurniture([params.classname]);
	const verified = furnitureHealth(after);
	if (verified.state !== "complete")
		return {
			...result,
			ok: false,
			error: verified.missing.length
				? `Repair incomplete. Still missing: ${verified.missing.join(", ")}`
				: "Repair completed with unresolved local conflicts or unreadable data",
		};
	return {
		...result,
		warnings: [
			...result.warnings,
			"Verified: SQL, furnidata, Nitro, icon and catalog offer are present",
		],
	};
}
