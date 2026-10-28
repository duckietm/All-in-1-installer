// @ts-nocheck
// Feasibility probe: splits the audit's missing-from-sources list per clone
// source, marks which sources can deliver .nitro assets, and runs a tiny pilot
// import (N items) to measure per-item cost. Writes a report to /tmp.
import { appendFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadEnvForLiveTests } from "@/test/live-env";

const runLive = process.env.RUN_CLONE_FEASIBILITY_LIVE === "1";
const LOG = "/tmp/clone-feasibility.log";
const log = (msg: string) => appendFileSync(LOG, `${msg}\n`);

describe("clone feasibility", {
	skip: !runLive,
}, () => {
	beforeAll(async () => {
		loadEnvForLiveTests();
	});

	it("reports per-source clonable counts + pilot", async () => {
		expect(process.env.DATABASE_URL).toMatch(/@/);
		const mod = await import("@/lib/services/clone-sources");
		const ci = await import("@/lib/services/clone-import");
		const sources = await mod.listSources();
		log(`sources: ${sources.length}`);
		const report: Array<Record<string, unknown>> = [];
		for (const source of sources) {
			const start = Date.now();
			try {
				const clonable = await ci.getClonableClassnames(source);
				const secs = ((Date.now() - start) / 1000).toFixed(1);
				log(
					`${source.name}: haveNitro=${Boolean(source.nitroBaseUrl)} clonable=${clonable.length} (${secs}s)`,
				);
				report.push({
					source: source.name,
					clonable: clonable.length,
					hasNitro: Boolean(source.nitroBaseUrl),
					secs: Number(secs),
				});
			} catch (err) {
				log(`  source ${source.name} FAILED: ${(err as Error).message}`);
				report.push({ source: source.name, error: (err as Error).message });
			}
		}
		const withNitro = report
			.filter((r) => r.hasNitro && typeof r.clonable === "number")
			.reduce((a, r) => a + (r.clonable as number), 0);
		const totalClonable = report
			.filter((r) => typeof r.clonable === "number")
			.reduce((a, r) => a + (r.clonable as number), 0);
		log(
			`TOTAL clonable (naive sum, may double-count overlaps): ${totalClonable}`,
		);
		log(`  of which from nitro-capable sources: ${withNitro}`);

		// Asset probe: HEAD the first 8 clonable classnames against each source's
		// nitro base to see which sources actually deliver .nitro files.
		for (const source of sources) {
			if (!source.nitroBaseUrl) continue;
			try {
				const clonable = await ci.getClonableClassnames(source);
				const statuses: string[] = [];
				for (const c of clonable.slice(0, 8)) {
					const url = `${source.nitroBaseUrl}/${c}.nitro`;
					try {
						const r = await fetch(url, {
							method: "HEAD",
							signal: AbortSignal.timeout(8000),
						});
						statuses.push(`${c}:${r.status}`);
					} catch {
						try {
							const r = await fetch(url, {
								signal: AbortSignal.timeout(8000),
							});
							statuses.push(`${c}:${r.status}`);
						} catch {
							statuses.push(`${c}:ERR`);
						}
					}
				}
				log(
					`PROBE ${source.name} (${clonable.length} clonable): ${JSON.stringify(statuses)}`,
				);
			} catch (err) {
				log(`PROBE ${source.name}: fetch fail ${(err as Error).message}`);
			}
		}

		// Pilot: import up to 5 items from the first nitro-capable source that
		// has clonable items, to measure per-item cost.
		const pilotSource: (typeof sources)[number] | null =
			sources.find((s) => s.nitroBaseUrl) ?? null;
		if (pilotSource) {
			const clonable = await ci.getClonableClassnames(pilotSource);
			const all = await ci.fetchSourceFurnidata(pilotSource.furnidataUrl);
			log(`PILOT source: ${pilotSource.name} clonable=${clonable.length}`);
			const sample = clonable.slice(0, 5);
			const start = Date.now();
			let ok = 0;
			let fail = 0;
			for (const classname of sample) {
				const entry = all.find((e) => e.classname === classname);
				if (!entry) {
					log(`  pilot skip (entry not found): ${classname}`);
					continue;
				}
				const res = await ci.cloneSingleFurni({ source: pilotSource, entry });
				log(
					`  pilot ${res.ok ? "OK" : "FAIL"} ${classname} -> ${
						res.error ?? "done"
					} ${res.warnings?.join(";") ?? ""}`,
				);
				if (res.ok) ok++;
				else fail++;
			}
			const secs = Date.now() - start;
			log(
				`PILOT done: ${ok} ok / ${fail} fail, ${(secs / 1000).toFixed(1)}s for ${sample.length} items`,
			);
			log(JSON.stringify(report, null, 2));
		} else {
			log("GEEN nitro-capabele bron gevonden; pilot overgeslagen.");
			log(JSON.stringify(report, null, 2));
		}
	}, 600000);
});
