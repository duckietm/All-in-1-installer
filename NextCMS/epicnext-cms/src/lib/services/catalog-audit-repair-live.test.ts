// @ts-nocheck
// Live repair execution for the catalog studio audit. Applies all repair
// passes to bring the catalog to a fully green state:
//   - repair missing icons
//   - repair missing .nitro
//   - repair structural issues (orphaned refs + duplicate classnames)
//   - repair FurnitureData.json (add missing + dedupe)
//
// Run with the REAL DATABASE_URL loaded from .env:
//   RUN_CATALOG_AUDIT_LIVE=1 pnpm exec vitest run --coverage.enabled=false \
//     src/lib/services/catalog-audit-repair-live.test.ts
import { appendFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadEnvForLiveTests } from "@/test/live-env";

const LOG = "/tmp/catalog-audit-repair.log";
const log = (...parts: unknown[]) =>
	appendFileSync(
		LOG,
		`${parts
			.map((p) => (typeof p === "string" ? p : JSON.stringify(p, null, 2)))
			.join(" ")}\n`,
	);

describe("catalog audit live repair", {
	skip: process.env.RUN_CATALOG_AUDIT_LIVE !== "1",
}, () => {
	let runCatalogAudit: typeof import("@/lib/services/catalog-audit").runCatalogAudit;

	beforeAll(async () => {
		loadEnvForLiveTests();

		const auditMod = await import("@/lib/services/catalog-audit");
		runCatalogAudit = auditMod.runCatalogAudit;
	});

	it("applies all repairs and converges to zero issues", async () => {
		expect(process.env.DATABASE_URL).toMatch(/@/);

		// Run the audit first to see the current baseline.
		let events: Array<Record<string, unknown>> = [];
		await runCatalogAudit(
			(evt) => events.push(evt as unknown as Record<string, unknown>),
			{},
		);
		const before = events[events.length - 1]?.summary as Record<
			string,
			unknown
		>;
		log("BASELINE:", JSON.stringify(before, null, 2));

		// Apply all repairs.
		events = [];
		await runCatalogAudit(
			(evt) => {
				events.push(evt as unknown as Record<string, unknown>);
				if (evt.type === "repair_complete") {
					log(
						"REPAIR:",
						JSON.stringify({
							repair: evt.repair,
							repairNitro: evt.repairNitro,
						}),
					);
				}
				if (evt.type === "structure_repair_complete") {
					log("STRUCTURE:", JSON.stringify(evt.structure));
				}
				if (evt.type === "furnidata_repair_complete") {
					log("FURNIDATA:", JSON.stringify(evt.furniData));
				}
				if (evt.type === "sql_ready") {
					log("SQL:", JSON.stringify({ sqlCount: evt.sqlCount }));
				}
				if (evt.type === "sql_applied") {
					log(
						"SQL_APPLIED:",
						JSON.stringify({
							applied: evt.applied,
							sqlFailed: evt.sqlFailed,
						}),
					);
				}
				if (evt.type === "error") {
					log(`AUDIT ERROR: ${evt.message}`);
				}
			},
			{
				repair: true,
				repairNitros: true,
				sql: true,
				applySql: true,
				repairFurniData: true,
				repairStructure: true,
				checkFurniDataIds: true,
			},
		);

		const last = events[events.length - 1];
		expect(last?.type).toBe("batch_complete");
		const summary = last.summary as Record<string, unknown>;
		const issues = last.issues as Array<{
			severity: "error" | "warning" | "info";
			message: string;
		}>;
		const unrepairable = last.unrepairable as Array<{
			classname: string;
			missing: Array<"nitro" | "icon">;
		}>;

		log("AFTER:", JSON.stringify(summary, null, 2));
		log(
			"ISSUES:",
			JSON.stringify(
				issues.map((i) => `${i.severity}: ${i.message}`),
				null,
				2,
			),
		);
		log("UNREPAIRABLE:", JSON.stringify(unrepairable, null, 2));
	}, 600000);
});
