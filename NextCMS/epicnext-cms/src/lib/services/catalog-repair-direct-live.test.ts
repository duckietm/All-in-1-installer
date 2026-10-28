// @ts-nocheck
// Direct repair execution against the live DB. Skips the slow clone-source
// comparison entirely and just runs the repair functions.
import { appendFileSync } from "node:fs";

const LOG = "/tmp/catalog-repair.log";
const log = (msg: string) => {
	appendFileSync(LOG, `${msg}\n`);
	console.log(msg);
};

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { loadEnvForLiveTests } from "@/test/live-env";

describe("catalog repair direct (live)", {
	skip: process.env.RUN_CATALOG_AUDIT_LIVE !== "1",
}, () => {
	let db: typeof import("@/lib/db").db;
	let repair: typeof import("@/lib/services/catalog-repair");

	beforeAll(async () => {
		loadEnvForLiveTests();

		const [dbMod, repairMod] = await Promise.all([
			import("@/lib/db"),
			import("@/lib/services/catalog-repair"),
		]);
		db = dbMod.db;
		repair = repairMod;
	});

	it("repairs orphaned catalog + duplicate classnames", async () => {
		expect(process.env.DATABASE_URL).toMatch(/@/);

		log("=== ORPHANED REPAIR ===");
		const orphan = await repair.repairOrphanedCatalog();
		log(`orphaned result: ${JSON.stringify(orphan)}`);

		log("=== DUPLICATE REPAIR ===");
		const dup = await repair.repairDuplicateClassnames();
		log(`duplicate result: ${JSON.stringify(dup)}`);

		log("=== VERIFY DUPLICATES ===");
		const [dupRows] = (await db.execute(sql`
			SELECT item_name, COUNT(*) as cnt
			FROM items_base
			GROUP BY item_name
			HAVING cnt > 1
		`)) as unknown as [Array<{ item_name: string; cnt: number }>, unknown];
		log(`remaining duplicate groups: ${JSON.stringify(dupRows)}`);
	}, 300000);
});
