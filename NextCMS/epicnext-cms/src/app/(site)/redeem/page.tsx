import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ContentCard, StatBlock } from "@/components/public/ui";
import { auth } from "@/lib/auth";
import { db, User } from "@/lib/db";
import RedeemForm from "./RedeemForm";

export default async function RedeemPage() {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	const t = await getTranslations("pages.redeem");
	const id = Number(session.user.id);

	// Show the signed-in user's current credit balance for context (fail soft).
	let user: { username: string; credits: number } | null = null;
	try {
		const [row] = await db
			.select({ username: User.username, credits: User.credits })
			.from(User)
			.where(eq(User.id, id))
			.limit(1);
		user = row ?? null;
	} catch {
		user = null;
	}

	if (!user) redirect("/login");

	return (
		<section className="page-grid">
			<ContentCard icon="🎟️" title={t("title")} subtitle={t("subtitle")} />

			<div className="card-grid sm-2">
				<ContentCard icon="🔑" title={t("enterCode")}>
					<RedeemForm />
					<p
						className="muted"
						style={{ marginBottom: 0, marginTop: "0.85rem" }}
					>
						{t("oncePerAccount")}
					</p>
				</ContentCard>

				<ContentCard
					icon="💰"
					title={t("balanceTitle")}
					subtitle={t("signedInAs", { username: user.username })}
				>
					<div className="stat-grid">
						<StatBlock
							value={user.credits.toLocaleString()}
							label={t("credits")}
							icon="🪙"
						/>
					</div>
					<p
						className="muted"
						style={{ marginBottom: 0, marginTop: "0.85rem" }}
					>
						{t("instantCredit")}
					</p>
				</ContentCard>
			</div>
		</section>
	);
}
