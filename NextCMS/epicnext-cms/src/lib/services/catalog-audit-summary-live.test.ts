// @ts-nocheck
// Read-only audit run that writes the full summary to a log file.
import { appendFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadEnvForLiveTests } from "@/test/live-env";

const LOG = "/tmp/catalog-audit-summary.log";
const log = (msg: string) => {
	appendFileSync(LOG, `${msg}\n`);
};

describe("catalog audit read-only summary", {
	skip: process.env.RUN_CATALOG_AUDIT_LIVE !== "1",
}, () => {
	let runCatalogAudit: typeof import("@/lib/services/catalog-audit").runCatalogAudit;

	beforeAll(async () => {
		loadEnvForLiveTests();

		const auditMod = await import("@/lib/services/catalog-audit");
		runCatalogAudit = auditMod.runCatalogAudit;
	});

	it("reports the full audit summary", async () => {
		expect(process.env.DATABASE_URL).toMatch(/@/);

		const events: Array<Record<string, unknown>> = [];
		await runCatalogAudit(
			(evt) => events.push(evt as unknown as Record<string, unknown>),
			{},
		);

		const last = events[events.length - 1];
		expect(last?.type).toBe("batch_complete");
		const summary = last.summary as Record<string, unknown>;
		const issues = last.issues as Array<{
			type: string;
			severity: string;
			message: string;
			classname?: string;
		}>;
		const unrepairable = last.unrepairable as Array<{
			classname: string;
			itemId: number;
			missing: Array<string>;
		}>;

		log("=== SUMMARY ===");
		log(JSON.stringify(summary, null, 2));
		log("=== ISSUES ===");
		log(JSON.stringify(issues, null, 2));
		log("=== UNREPAIRABLE ===");
		log(JSON.stringify(unrepairable, null, 2));
	}, 300000);
});
