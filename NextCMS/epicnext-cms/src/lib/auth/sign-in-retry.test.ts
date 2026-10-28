import { describe, expect, it, vi } from "vitest";
import { signInWithTransientRetry } from "./sign-in-retry";

describe("signInWithTransientRetry", () => {
	it("retries thrown transport errors with a short backoff", async () => {
		const transportError = new SyntaxError("unexpected character in JSON");
		const signIn = vi
			.fn<() => Promise<{ ok: boolean }>>()
			.mockRejectedValueOnce(transportError)
			.mockRejectedValueOnce(transportError)
			.mockResolvedValue({ ok: true });
		const wait = vi.fn(async () => undefined);

		await expect(signInWithTransientRetry(signIn, wait)).resolves.toEqual({
			ok: true,
		});
		expect(signIn).toHaveBeenCalledTimes(3);
		expect(wait).toHaveBeenNthCalledWith(1, 400);
		expect(wait).toHaveBeenNthCalledWith(2, 800);
	});

	it("returns ordinary auth responses without retrying", async () => {
		const response = { ok: false, error: "CredentialsSignin" };
		const signIn = vi.fn(async () => response);
		const wait = vi.fn(async () => undefined);

		await expect(signInWithTransientRetry(signIn, wait)).resolves.toBe(
			response,
		);
		expect(signIn).toHaveBeenCalledOnce();
		expect(wait).not.toHaveBeenCalled();
	});

	it("rethrows the last transport error after four attempts", async () => {
		const transportError = new Error("temporary upstream failure");
		const signIn = vi
			.fn<() => Promise<never>>()
			.mockRejectedValue(transportError);
		const wait = vi.fn(async () => undefined);

		await expect(signInWithTransientRetry(signIn, wait)).rejects.toBe(
			transportError,
		);
		expect(signIn).toHaveBeenCalledTimes(4);
		expect(wait).toHaveBeenCalledTimes(3);
	});
});
