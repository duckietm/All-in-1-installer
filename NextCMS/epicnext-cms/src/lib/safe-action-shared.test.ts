// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const foundationHandle = vi.hoisted(() => vi.fn());

vi.mock("@/lib/foundation/action", () => ({
	handleActionError: foundationHandle,
}));

import { actionError, actionOk, handleActionError } from "./safe-action-shared";

describe("actionOk", () => {
	it("wraps data in a success result", () => {
		expect(actionOk({ id: 1 })).toEqual({ ok: true, data: { id: 1 } });
	});
	it("defaults to an empty object when no data is given", () => {
		expect(actionOk()).toEqual({ ok: true, data: {} });
	});
});

describe("actionError", () => {
	it("wraps a message in a failure result", () => {
		expect(actionError("boom")).toEqual({ ok: false, error: "boom" });
	});
});

describe("handleActionError", () => {
	it("maps ZodErrors to validation failures with field errors", () => {
		const schema = z.object({ name: z.string().min(3) });
		const parsed = schema.safeParse({ name: "x" });
		const result = handleActionError(parsed.success ? undefined : parsed.error);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("Validation failed");
			expect(result.fieldErrors?.name).toBeTruthy();
		}
	});

	it("maps ActionError instances by name", () => {
		const err = new Error("not allowed");
		err.name = "ActionError";
		expect(handleActionError(err)).toEqual({
			ok: false,
			error: "not allowed",
		});
	});

	it("delegates unknown errors to the foundation handler", () => {
		foundationHandle.mockReturnValue({ ok: false, error: "generic" });
		const result = handleActionError(new Error("generic"));
		expect(foundationHandle).toHaveBeenCalled();
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("generic");
		}
	});
});
