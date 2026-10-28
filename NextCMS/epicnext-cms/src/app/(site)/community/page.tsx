import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { ContentCard } from "@/components/public/ui";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.community");
	return {
		title: t("title"),
		description: t("subtitle"),
		openGraph: {
			title: t("title"),
			description: t("subtitle"),
			type: "website",
		},
	};
}

const LINKS = [
	{
		key: "rankings",
		href: "/rankings",
		icon: "🏆",
	},
	{
		key: "staff",
		href: "/staff",
		icon: "🛡️",
	},
	{
		key: "news",
		href: "/news",
		icon: "📰",
	},
	{
		key: "photos",
		href: "/photos",
		icon: "📸",
	},
	{
		key: "guilds",
		href: "/guilds",
		icon: "🚪",
	},
	{
		key: "leaderboards",
		href: "/leaderboard",
		icon: "📊",
	},
];

export default function CommunityPage() {
	const t = useTranslations("pages.community");

	return (
		<section className="page-grid">
			<ContentCard icon="🌍" title={t("title")} subtitle={t("subtitle")} />

			<div className="card-grid sm-2 lg-3">
				{LINKS.map((l) => (
					<Link
						key={l.href}
						href={l.href}
						className="content-card hover-lift"
						style={{ color: "inherit", textDecoration: "none" }}
					>
						<div className="content-card-head">
							<span className="content-card-icon" aria-hidden>
								{l.icon}
							</span>
							<div className="content-card-head-text">
								<p className="content-card-title">
									{t(`links.${l.key}.title`)}
								</p>
							</div>
						</div>
						<div className="content-card-body">
							<p className="muted" style={{ margin: "0 0 0.75rem" }}>
								{t(`links.${l.key}.text`)}
							</p>
							<span className="btn btn-outline">{t("open")}</span>
						</div>
					</Link>
				))}
			</div>
		</section>
	);
}
