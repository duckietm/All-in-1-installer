import { eq, sql } from "drizzle-orm";
import { db, User, UsersCurrency } from "@/lib/db";
import type { RconClient } from "@/lib/services/rcon";

export type CurrencyName = "credits" | "duckets" | "diamonds" | "points";

// users_currency.type values for the non-credits currencies.
const TYPE_VALUE: Record<Exclude<CurrencyName, "credits">, number> = {
	duckets: 0,
	diamonds: 5,
	points: 101,
};

export interface CurrencyDb {
	user: {
		update(args: {
			where: { id: number };
			data: { credits: { increment: number } };
		}): Promise<unknown>;
	};
	usersCurrency: {
		upsert(args: {
			where: { userId_type: { userId: number; type: number } };
			update: { amount: { increment: number } };
			create: { userId: number; type: number; amount: number };
		}): Promise<unknown>;
	};
}

/** Drizzle-backed CurrencyDb used by shop / voucher / referral (and callers). */
export const currencyDb: CurrencyDb = {
	user: {
		async update({ where, data }) {
			await db
				.update(User)
				.set({
					credits: sql`${User.credits} + ${data.credits.increment}`,
				})
				.where(eq(User.id, where.id));
		},
	},
	usersCurrency: {
		async upsert({ update, create }) {
			await db
				.insert(UsersCurrency)
				.values(create)
				.onDuplicateKeyUpdate({
					set: {
						amount: sql`${UsersCurrency.amount} + ${update.amount.increment}`,
					},
				});
		},
	},
};

export interface SendCurrencyDeps {
	rcon: Pick<
		RconClient,
		"giveCredits" | "giveDuckets" | "giveDiamonds" | "givePointsGotw"
	>;
	db: CurrencyDb;
}

/**
 * Mirrors AtomCMS's SendCurrency action: deliver via RCON, falling back to a
 * direct DB write when RCON delivery fails (the PHP version checks
 * rcon->isConnected up front; trying-then-falling-back is equivalent and more
 * robust). Credits live on users.credits; duckets/diamonds/points live in
 * users_currency keyed by (user_id, type).
 */
export async function sendCurrency(
	deps: SendCurrencyDeps,
	userId: number,
	type: CurrencyName,
	amount: number | null | undefined,
): Promise<boolean> {
	if (!amount || amount <= 0) return false;

	if (await rconDeliver(deps.rcon, userId, type, amount)) return true;

	if (type === "credits") {
		await deps.db.user.update({
			where: { id: userId },
			data: { credits: { increment: amount } },
		});
	} else {
		// type is CurrencyName union, not "credits"
		const t = TYPE_VALUE[type];
		await deps.db.usersCurrency.upsert({
			where: { userId_type: { userId, type: t } },
			update: { amount: { increment: amount } },
			create: { userId, type: t, amount },
		});
	}
	return true;
}

function rconDeliver(
	rcon: SendCurrencyDeps["rcon"],
	userId: number,
	type: CurrencyName,
	amount: number,
): Promise<boolean> {
	switch (type) {
		case "credits":
			return rcon.giveCredits(userId, amount);
		case "duckets":
			return rcon.giveDuckets(userId, amount);
		case "diamonds":
			return rcon.giveDiamonds(userId, amount);
		case "points":
			return rcon.givePointsGotw(userId, amount);
	}
}
