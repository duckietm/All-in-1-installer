import { and, desc, eq, gt, or } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { ContentCard } from "@/components/public/ui";
import { auth } from "@/lib/auth";
import { unixNow } from "@/lib/bans";
import { Ban, db } from "@/lib/db";

const FAR_FUTURE = Math.floor(Date.now() / 1000) + 50 * 365 * 24 * 3600;

export default async function BannedPage() {
	const t = await getTranslations("pages.banned");
	const session = await auth();
	let reason = "";
	let expire = 0;
	let hasBan = false;
	if (session?.user?.id) {
		try {
			const now = unixNow();
			const [ban] = await db
				.select({
					banReason: Ban.banReason,
					banExpire: Ban.banExpire,
				})
				.from(Ban)
				.where(
					and(
						eq(Ban.userId, Number(session.user.id)),
						or(eq(Ban.banExpire, 0), gt(Ban.banExpire, now)),
					),
				)
				.orderBy(desc(Ban.timestamp))
				.limit(1);
			if (ban) {
				hasBan = true;
				reason = ban.banReason;
				expire = ban.banExpire;
			}
		} catch {
			// show generic message
		}
	}

	const expiryText = !hasBan
		? ""
		: expire === 0 || expire > FAR_FUTURE
			? t("permanent")
			: t("expires", {
					date: new Date(expire * 1000)
						.toISOString()
						.slice(0, 16)
						.replace("T", " "),
				});

	return (
		<section style={{ maxWidth: 560, margin: "2rem auto" }}>
			<ContentCard icon="🚫" title={t("title")} subtitle={t("subtitle")}>
				<p style={{ marginTop: 0 }}>{t("body")}</p>
				{reason ? (
					<p>
						<strong>{t("reasonLabel")}</strong> {reason}
					</p>
				) : null}
				{expiryText ? <p className="muted">{expiryText}</p> : null}
				<p className="muted" style={{ marginBottom: 0 }}>
					{t("contactStaff")}
				</p>
			</ContentCard>
		</section>
	);
}
