import { sql } from "drizzle-orm";
import { queryRows } from "@/lib/db";
import { findFurniDataIdConflict } from "./furni-data";

let reservation: Promise<void> = Promise.resolve();
/** Reserve both SQL and client identifiers by inserting while holding the local queue.
 * The primary key handles competing processes; only duplicate-key failures retry.
 */
export async function reserveFurnitureId(
	preferred: number,
	classname: string,
	insert: (id: number) => Promise<void>,
): Promise<number> {
	let release!: () => void;
	const previous = reservation;
	reservation = new Promise<void>((resolve) => {
		release = resolve;
	});
	await previous;
	try {
		let candidate = preferred;
		for (let attempt = 0; attempt < 100; attempt++) {
			if (
				!Number.isSafeInteger(candidate) ||
				candidate < 1 ||
				candidate > 2147483647
			)
				throw new Error("No valid furniture ID is available");
			const owners = await queryRows<{ item_name: string }>(
				sql`SELECT item_name FROM items_base WHERE id = ${candidate} OR sprite_id = ${candidate} LIMIT 1`,
			);
			const occupied =
				owners.length > 0 ||
				!!(await findFurniDataIdConflict(candidate, classname));
			if (!occupied) {
				try {
					await insert(candidate);
					return candidate;
				} catch (error) {
					const cause =
						(error as { cause?: { code?: string; errno?: number } }).cause ??
						(error as { code?: string; errno?: number });
					if (cause.code !== "ER_DUP_ENTRY" && cause.errno !== 1062)
						throw error;
				}
			}
			const rows = await queryRows<{ maximum: number | string }>(
				sql`SELECT GREATEST(COALESCE(MAX(id), 0), COALESCE(MAX(sprite_id), 0)) AS maximum FROM items_base`,
			);
			candidate = Math.max(candidate + 1, Number(rows[0]?.maximum ?? 0) + 1);
		}
		throw new Error("Cannot reserve a free furniture ID; retry the import");
	} finally {
		release();
	}
}
