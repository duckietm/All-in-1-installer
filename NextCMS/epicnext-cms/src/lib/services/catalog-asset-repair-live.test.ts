// @ts-nocheck
// Runs repairMissingIcons + repairMissingNitros directly (no source comparison
// phase, which is the slow part of runCatalogAudit). Logs progress to a file.
import { appendFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadEnvForLiveTests } from "@/test/live-env";

const LOG = "/tmp/catalog-asset-repair.log";
const log = (msg: string) => {
	appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`);
};

describe("catalog asset repair (live)", () => {
	let repairIcons: typeof import("@/lib/services/repair-icons").repairMissingIcons;
	let repairNitros: typeof import("@/lib/services/repair-nitros").repairMissingNitros;

	beforeAll(async () => {
		loadEnvForLiveTests();
		process.env.SKIP_ENV_VALIDATION = "1";

		[repairIcons, repairNitros] = await Promise.all([
			import("@/lib/services/repair-icons").then((m) => m.repairMissingIcons),
			import("@/lib/services/repair-nitros").then((m) => m.repairMissingNitros),
		]);
	});

	it("repairs missing icons then nitros", async () => {
		expect(process.env.DATABASE_URL).toMatch(/@/);

		log("=== ICON REPAIR START ===");
		let lastPct = -1;
		const iconResult = await repairIcons((evt) => {
			if (evt.type === "progress" && evt.total) {
				const pct = Math.round(((evt.index ?? 0) / evt.total) * 100);
				if (pct % 5 === 0 && pct !== lastPct) {
					lastPct = pct;
					log(`icons ${evt.index}/${evt.total} (${pct}%)`);
				}
				if (evt.status === "done") log(`ICON DONE: ${evt.classname}`);
				if (evt.status === "failed")
					log(`ICON FAIL: ${evt.classname} :: ${evt.message ?? ""}`);
			}
			if (evt.type === "error") log(`ICON ERROR: ${evt.message ?? ""}`);
		});
		log(`icon result: ${JSON.stringify(iconResult)}`);

		log("=== NITRO REPAIR START ===");
		lastPct = -1;
		const nitroResult = await repairNitros((evt) => {
			if (evt.type === "progress" && evt.total) {
				const pct = Math.round(((evt.index ?? 0) / evt.total) * 100);
				if (pct % 5 === 0 && pct !== lastPct) {
					lastPct = pct;
					log(`nitros ${evt.index}/${evt.total} (${pct}%)`);
				}
				if (evt.status === "done") log(`NITRO DONE: ${evt.classname}`);
				if (evt.status === "failed")
					log(`NITRO FAIL: ${evt.classname} :: ${evt.message ?? ""}`);
			}
			if (evt.type === "error") log(`NITRO ERROR: ${evt.message ?? ""}`);
		});
		log(`nitro result: ${JSON.stringify(nitroResult)}`);

		log("=== ASSET REPAIR COMPLETE ===");
		log(`icons: ${JSON.stringify(iconResult)}`);
		log(`nitros: ${JSON.stringify(nitroResult)}`);
	}, 1800000);
});
