// @ts-nocheck
// Bulk-import live run: imports every cloneable item from the sources that
// reliably serve .nitro assets (SodaStudios, Hubbly). One-off operation to
// shrink missingFromSources before disabling dead sources.
import { appendFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadEnvForLiveTests } from "@/test/live-env";

const runLive = process.env.RUN_CLONE_BULK_LIVE === "1";
const LOG = "/tmp/clone-bulk.log";
const log = (msg: string) => appendFileSync(LOG, `${msg}\n`);

// Source ids that reliably serve .nitro files (verified 2026-09).
const IMPORT_IDS = ["default-sodastudios", "default-hubbly"];

describe("clone bulk import", {
	skip: !runLive,
}, () => {
	beforeAll(async () => {
		loadEnvForLiveTests();
	});

	it("imports clonable items from delivering sources", async () => {
		expect(process.env.DATABASE_URL).toMatch(/@/);
		const mod = await import("@/lib/services/clone-sources");
		const ci = await import("@/lib/services/clone-import");
		const sources = await mod.listSources();
		log(`START bulk import ${new Date().toISOString()}`);

		for (const id of IMPORT_IDS) {
			const source = sources.find((s) => s.id === id);
			if (!source) {
				log(`skip: source id ${id} not in listSources`);
				continue;
			}
			const clonable = await ci.getClonableClassnames(source);
			const all = await ci.fetchSourceFurnidata(source.furnidataUrl);
			const entryFor = (classname: string) =>
				all.find((e) => e.classname === classname);
			log(
				`SOURCE ${source.name}: ${clonable.length} clonable (fetched ${all.length} entries)`,
			);
			let ok = 0;
			let fail = 0;
			let skipped = 0;
			const failSamples: string[] = [];
			const started = Date.now();
			for (let i = 0; i < clonable.length; i++) {
				const classname = clonable[i];
				const entry = entryFor(classname);
				if (!entry) {
					skipped++;
					continue;
				}
				const res = await ci.cloneSingleFurni({ source, entry });
				if (res.ok) ok++;
				else if ("skipped" in res && res.skipped) skipped++;
				else {
					fail++;
					if (failSamples.length < 30) {
						failSamples.push(`${classname}: ${res.error}`);
					}
				}
				if ((i + 1) % 50 === 0) {
					const elapsed = ((Date.now() - started) / 1000).toFixed(0);
					log(
						`  ${source.name} ${i + 1}/${clonable.length} ok=${ok} fail=${fail} skipped=${skipped} (${elapsed}s)`,
					);
				}
			}
			const secs = ((Date.now() - started) / 1000).toFixed(0);
			log(
				`DONE ${source.name}: ok=${ok} fail=${fail} skipped=${skipped} in ${secs}s`,
			);
			if (failSamples.length) {
				log(`  fail samples:\n    ${failSamples.join("\n    ")}`);
			}
		}
		log(`END bulk import ${new Date().toISOString()}`);
	}, 1800000);
});
