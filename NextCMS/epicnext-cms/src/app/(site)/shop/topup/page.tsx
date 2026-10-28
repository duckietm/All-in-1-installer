import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ContentCard, StatBlock } from "@/components/public/ui";
import { auth } from "@/lib/auth";
import { db, User } from "@/lib/db";
import {
	creditsPerUnit,
	isPayPalConfigured,
	PAYPAL_CURRENCY,
} from "@/lib/services/paypal";
import TopUpForm from "./TopUpForm";

export default async function TopUpPage({
	searchParams,
}: {
	searchParams: Promise<{ status?: string }>;
}) {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	const t = await getTranslations("pages.topup");
	const sp = await searchParams;
	const id = Number(session.user.id);

	// Current credits balance for context (fail soft).
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

	const configured = isPayPalConfigured();
	const rate = creditsPerUnit();

	return (
		<section className="page-grid">
			<ContentCard icon="💳" title={t("title")} subtitle={t("subtitle")} />

			{sp.status === "cancel" ? (
				<div className="card" style={{ borderColor: "var(--color-danger)" }}>
					<p style={{ margin: 0 }}>{t("cancelled")}</p>
				</div>
			) : null}

			<div className="card-grid sm-2">
				<ContentCard icon="🪙" title={t("chooseAmount")}>
					{configured ? (
						<TopUpForm currency={PAYPAL_CURRENCY} creditsPerUnit={rate} />
					) : (
						<p className="muted" style={{ margin: 0 }}>
							{t("notConfiguredPre")} <code>PAYPAL_CLIENT_ID</code>{" "}
							{t("notConfiguredAnd")} <code>PAYPAL_SECRET</code>{" "}
							{t("notConfiguredOptional")} <code>PAYPAL_API</code>{" "}
							{t("notConfiguredPost")}
						</p>
					)}
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
						<StatBlock
							value={rate.toLocaleString()}
							label={t("creditsPerUnit", { currency: PAYPAL_CURRENCY })}
						/>
					</div>
					<p
						className="muted"
						style={{ marginBottom: 0, marginTop: "0.85rem" }}
					>
						{t.rich("rateLine", {
							amount: rate.toLocaleString(),
							currency: PAYPAL_CURRENCY,
							strong: (chunks) => <strong>{chunks}</strong>,
						})}
					</p>
				</ContentCard>
			</div>
		</section>
	);
}
