import { expect, it } from "vitest";
import { migrationState, workerState } from "./installation-state";

it("distinguishes missing, malformed and stale worker evidence", () => {
	const now = Date.parse("2026-09-09T12:00:00Z");
	expect(workerState(null, now)).toBe("unknown");
	expect(workerState("bad", now)).toBe("unknown");
	expect(workerState("2026-09-09T11:59:30Z", now)).toBe("ok");
	expect(workerState("2026-09-09T11:55:00Z", now)).toBe("failed");
});
it("never treats missing migration history as up to date", () => {
	expect(migrationState(["0026"], null)).toEqual({
		state: "unknown",
		pending: null,
	});
	expect(migrationState(["0025", "0026"], ["0025"])).toEqual({
		state: "failed",
		pending: 1,
	});
	expect(migrationState(["0026"], ["0026"])).toEqual({
		state: "ok",
		pending: 0,
	});
});
