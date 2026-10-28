import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-handler";
import { db, User } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { rcon } from "@/lib/services/rcon";
import { logStaffActivity } from "@/lib/services/staff-activity";

/** Currency grants are capped: an unbounded `amount` minted an economy-breaking
 *  balance with a single request. */
function positiveAmount(amount: number): boolean {
	return Number.isInteger(amount) && amount > 0 && amount <= MAX_CURRENCY_GRANT;
}

const MAX_CURRENCY_GRANT = 1_000_000;

export const POST = withAdmin(
	{ permission: PERMS.USERS_EDIT },
	async (request, context) => {
		const staffId = context.session.user.id;
		const staffRank = context.session.user.rank;
		const isSuper = context.permissions.isSuperAdmin;
		const formData = await request.formData();
		const userId = Number(formData.get("userId"));
		const username = String(formData.get("username") || "");
		const action = String(formData.get("action") || "");

		if (!userId || !username) {
			return NextResponse.json(
				{ success: false, message: "Invalid user data" },
				{ status: 400 },
			);
		}

		// Every branch below acts on a live account, so the rank guard that the
		// set_rank branch already applies belongs to all of them: staff may not
		// act on users at or above their own rank unless they are the hotel's
		// dynamic owner.
		if (action !== "set_rank") {
			const [target] = await db
				.select({ rank: User.rank })
				.from(User)
				.where(eq(User.id, userId))
				.limit(1);
			if (!target) {
				return NextResponse.json(
					{ success: false, message: "User not found" },
					{ status: 404 },
				);
			}
			if (!isSuper && target.rank >= staffRank) {
				return NextResponse.json(
					{
						success: false,
						message: "Cannot act on a user at or above your rank",
					},
					{ status: 403 },
				);
			}
		}

		if (action === "set_rank") {
			const rank = Number(formData.get("rank") || "0");
			if (!Number.isInteger(rank) || rank < 1) {
				return NextResponse.json(
					{ success: false, message: "Invalid rank value" },
					{ status: 400 },
				);
			}

			const [rankExists] = (await db
				.execute(
					sql`SELECT id FROM permission_ranks WHERE id = ${rank} LIMIT 1`,
				)
				.catch(() => [[]] as unknown as [unknown[], unknown])) as unknown as [
				{ id: number }[],
				unknown,
			];
			if (rankExists.length === 0) {
				return NextResponse.json(
					{ success: false, message: "Rank does not exist" },
					{ status: 400 },
				);
			}

			const [target] = await db
				.select({ rank: User.rank })
				.from(User)
				.where(eq(User.id, userId))
				.limit(1);
			if (!target) {
				return NextResponse.json(
					{ success: false, message: "User not found" },
					{ status: 404 },
				);
			}

			const isSuper = context.permissions.isSuperAdmin;
			if (!isSuper) {
				if (target.rank >= staffRank) {
					return NextResponse.json(
						{
							success: false,
							message: "Cannot change rank of a user at or above your rank",
						},
						{ status: 403 },
					);
				}
				if (rank >= staffRank) {
					return NextResponse.json(
						{
							success: false,
							message: "Cannot set a rank equal to or above your own",
						},
						{ status: 403 },
					);
				}
			}

			await db.update(User).set({ rank }).where(eq(User.id, userId));
			await rcon.setRank(userId, rank);
			await logStaffActivity({
				staffId,
				action: "rank_change",
				description: `Set rank of user #${userId} to ${rank}`,
				targetType: "user",
				targetId: userId,
			});

			return NextResponse.json(
				{ success: true, message: `Set rank of user #${userId} to ${rank}` },
				{ status: 200 },
			);
		}

		if (action === "disconnect") {
			await rcon.disconnectUser(userId, username);
			await logStaffActivity({
				staffId,
				action: "disconnect",
				description: `Disconnected user #${userId} (${username})`,
				targetType: "user",
				targetId: userId,
			});
			return NextResponse.json(
				{
					success: true,
					message: `Disconnected user #${userId} (${username})`,
				},
				{ status: 200 },
			);
		}

		if (action === "alert") {
			const message = String(formData.get("message") || "")
				.trim()
				.slice(0, 512);
			if (!message) {
				return NextResponse.json(
					{ success: false, message: "Alert message is required" },
					{ status: 400 },
				);
			}
			await rcon.alertUser(userId, message);
			await logStaffActivity({
				staffId,
				action: "alert_user",
				description: `Sent alert to user #${userId}`,
				targetType: "user",
				targetId: userId,
			});
			return NextResponse.json(
				{ success: true, message: `Sent alert to user #${userId}` },
				{ status: 200 },
			);
		}

		if (action === "give_credits") {
			const credits = Number(formData.get("credits") || "0");
			if (!positiveAmount(credits)) {
				return NextResponse.json(
					{ success: false, message: "Invalid credit amount" },
					{ status: 400 },
				);
			}
			await rcon.giveCredits(userId, credits);
			await logStaffActivity({
				staffId,
				action: "give_currency",
				description: `Gave ${credits} credits to user #${userId}`,
				targetType: "user",
				targetId: userId,
			});
			return NextResponse.json(
				{
					success: true,
					message: `Gave ${credits} credits to user #${userId}`,
				},
				{ status: 200 },
			);
		}

		if (action === "give_duckets") {
			const amount = Number(formData.get("amount") || "0");
			if (!positiveAmount(amount)) {
				return NextResponse.json(
					{ success: false, message: "Invalid duckets amount" },
					{ status: 400 },
				);
			}
			await rcon.giveDuckets(userId, amount);
			await logStaffActivity({
				staffId,
				action: "give_currency",
				description: `Gave ${amount} duckets to user #${userId}`,
				targetType: "user",
				targetId: userId,
			});
			return NextResponse.json(
				{ success: true, message: `Gave ${amount} duckets to user #${userId}` },
				{ status: 200 },
			);
		}

		if (action === "give_diamonds") {
			const amount = Number(formData.get("amount") || "0");
			if (!positiveAmount(amount)) {
				return NextResponse.json(
					{ success: false, message: "Invalid diamonds amount" },
					{ status: 400 },
				);
			}
			await rcon.giveDiamonds(userId, amount);
			await logStaffActivity({
				staffId,
				action: "give_currency",
				description: `Gave ${amount} diamonds to user #${userId}`,
				targetType: "user",
				targetId: userId,
			});
			return NextResponse.json(
				{
					success: true,
					message: `Gave ${amount} diamonds to user #${userId}`,
				},
				{ status: 200 },
			);
		}

		if (action === "give_points") {
			const amount = Number(formData.get("amount") || "0");
			if (!positiveAmount(amount)) {
				return NextResponse.json(
					{ success: false, message: "Invalid points amount" },
					{ status: 400 },
				);
			}
			await rcon.givePointsGotw(userId, amount);
			await logStaffActivity({
				staffId,
				action: "give_currency",
				description: `Gave ${amount} points to user #${userId}`,
				targetType: "user",
				targetId: userId,
			});
			return NextResponse.json(
				{ success: true, message: `Gave ${amount} points to user #${userId}` },
				{ status: 200 },
			);
		}

		return NextResponse.json(
			{ success: false, message: `Unknown action: ${action}` },
			{ status: 400 },
		);
	},
);
