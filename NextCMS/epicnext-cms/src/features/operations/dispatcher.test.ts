// @ts-nocheck
import { expect, it, vi } from "vitest";
import { dispatchEffects } from "./dispatcher";

it("settles only after successful delivery and preserves the claim token", async () => {
	const effect = {
		id: "a",
		token: "lease1",
		topic: "catalog.refresh" as const,
		attempts: 1,
	};
	const repo = {
		claim: vi.fn().mockResolvedValueOnce(effect).mockResolvedValue(null),
		complete: vi.fn(),
		fail: vi.fn(),
	};
	const deliver = vi.fn();
	await dispatchEffects(repo, deliver);
	expect(deliver).toHaveBeenCalledWith(effect);
	expect(repo.complete).toHaveBeenCalledWith(effect);
	expect(repo.fail).not.toHaveBeenCalled();
});
it("persists failures and continues to other pending work", async () => {
	const effect = {
		id: "a",
		token: "lease1",
		topic: "catalog.refresh" as const,
		attempts: 1,
	};
	const repo = {
		claim: vi.fn().mockResolvedValueOnce(effect).mockResolvedValue(null),
		complete: vi.fn(),
		fail: vi.fn(),
	};
	const failure = Error("private");
	await dispatchEffects(repo, vi.fn().mockRejectedValue(failure));
	expect(repo.fail).toHaveBeenCalledWith(effect, failure);
	expect(repo.complete).not.toHaveBeenCalled();
});
it("bounds work per tick instead of draining indefinitely", async () => {
	const repo = {
		claim: vi.fn().mockResolvedValue({
			id: "a",
			token: "t",
			topic: "catalog.refresh",
			attempts: 1,
		}),
		complete: vi.fn(),
		fail: vi.fn(),
	};
	await dispatchEffects(repo, async () => {});
	expect(repo.claim).toHaveBeenCalledTimes(20);
});
