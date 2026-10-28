import { describe, it } from "vitest";

// Integration test against the live database. Vitest runs without a populated
// .env (SKIP_ENV_VALIDATION=1), so only execute when a DATABASE_URL is provided.
const hasDb =
	typeof process.env.DATABASE_URL === "string" &&
	process.env.DATABASE_URL.length > 0;

describe.skipIf(!hasDb)("repair icons", () => {
	it("runs icon repair", async () => {
		const { repairMissingIcons } = await import("@/lib/services/repair-icons");

		const result = await repairMissingIcons((evt) => {
			if (evt.type === "batch_complete") {
				console.log("BATCH COMPLETE:", JSON.stringify(evt));
			} else if (evt.type === "error") {
				console.log("ERROR:", evt.message);
			}
		});
		console.log("Result:", JSON.stringify(result));
	}, 600_000);
});
