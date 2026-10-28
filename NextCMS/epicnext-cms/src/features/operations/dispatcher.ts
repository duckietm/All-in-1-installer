import type { EffectClaim } from "./model";
export interface EffectRepository {
	claim(): Promise<EffectClaim | null>;
	complete(claim: EffectClaim): Promise<unknown>;
	fail(claim: EffectClaim, error: unknown): Promise<unknown>;
}
/** At-least-once delivery: handlers must tolerate replay after an expired claim. */
export async function dispatchEffects(
	repo: EffectRepository,
	deliver: (claim: EffectClaim) => Promise<unknown>,
) {
	for (let i = 0; i < 20; i++) {
		const claim = await repo.claim();
		if (!claim) return;
		try {
			await deliver(claim);
		} catch (error) {
			await repo.fail(claim, error);
			continue;
		}
		await repo.complete(claim);
	}
}
