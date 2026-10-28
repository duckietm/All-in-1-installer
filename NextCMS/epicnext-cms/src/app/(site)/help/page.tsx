import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.help");
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

import { ContentCard, EmptyState } from "@/components/public/ui";
import {
	db,
	WebsiteHelpCenterCategories,
	WebsiteRuleCategories,
	WebsiteRules,
} from "@/lib/db";
import { publicAssetExists } from "@/lib/public-asset";

// Asset path matches AtomCMS's Blade view: asset('/assets/images/help-center/<image_url>').
const HELP_IMAGE_BASE = "/assets/images/help-center";

type HelpCategory = {
	id: bigint;
	name: string;
	content: string;
	imageUrl: string | null;
	buttonText: string | null;
	buttonUrl: string | null;
	buttonColor: string;
	buttonBorderColor: string;
	smallBox: boolean;
};

type RuleCategory = {
	id: bigint;
	name: string;
	description: string;
	badge: string;
};

type Rule = {
	id: bigint;
	categoryId: bigint | null;
	paragraph: string;
	rule: string;
};

function isExternal(url: string): boolean {
	return /^https?:\/\//i.test(url);
}

export default async function HelpCenterPage() {
	const t = await getTranslations("pages.help");

	let categories: HelpCategory[] = [];
	try {
		categories = await db
			.select({
				id: WebsiteHelpCenterCategories.id,
				name: WebsiteHelpCenterCategories.name,
				content: WebsiteHelpCenterCategories.content,
				imageUrl: WebsiteHelpCenterCategories.imageUrl,
				buttonText: WebsiteHelpCenterCategories.buttonText,
				buttonUrl: WebsiteHelpCenterCategories.buttonUrl,
				buttonColor: WebsiteHelpCenterCategories.buttonColor,
				buttonBorderColor: WebsiteHelpCenterCategories.buttonBorderColor,
				smallBox: WebsiteHelpCenterCategories.smallBox,
			})
			.from(WebsiteHelpCenterCategories)
			.orderBy(
				asc(WebsiteHelpCenterCategories.position),
				asc(WebsiteHelpCenterCategories.id),
			);
	} catch {
		// DB unavailable — render the shell without help categories.
	}

	let ruleCategories: RuleCategory[] = [];
	try {
		ruleCategories = await db
			.select({
				id: WebsiteRuleCategories.id,
				name: WebsiteRuleCategories.name,
				description: WebsiteRuleCategories.description,
				badge: WebsiteRuleCategories.badge,
			})
			.from(WebsiteRuleCategories)
			.orderBy(asc(WebsiteRuleCategories.id));
	} catch {
		// DB unavailable — render the shell without rule categories.
	}

	let rules: Rule[] = [];
	try {
		rules = await db
			.select({
				id: WebsiteRules.id,
				categoryId: WebsiteRules.categoryId,
				paragraph: WebsiteRules.paragraph,
				rule: WebsiteRules.rule,
			})
			.from(WebsiteRules)
			.orderBy(
				asc(WebsiteRules.categoryId),
				asc(WebsiteRules.paragraph),
				asc(WebsiteRules.id),
			);
	} catch {
		// DB unavailable — render the shell without rules.
	}

	// Group the rules under their categories.
	const rulesByCategory = new Map<string, Rule[]>();
	for (const r of rules) {
		const key = r.categoryId === null ? "" : String(r.categoryId);
		const list = rulesByCategory.get(key);
		if (list) {
			list.push(r);
		} else {
			rulesByCategory.set(key, [r]);
		}
	}

	return (
		<section className="page-grid">
			<ContentCard
				icon="❓"
				title={t("title")}
				subtitle={t("subtitle")}
				action={
					<Link className="btn btn-outline" href="/help/tickets">
						{t("myTickets")}
					</Link>
				}
			/>

			<ContentCard
				icon="🧭"
				title={t("topicsTitle")}
				subtitle={t("topicsSubtitle")}
				padded={categories.length === 0}
			>
				{categories.length === 0 ? (
					<EmptyState icon="🧭">{t("topicsEmpty")}</EmptyState>
				) : (
					<div className="card-grid sm-2 lg-3" style={{ padding: "1rem" }}>
						{categories.map((c) => {
							const imageSrc = c.imageUrl
								? `${HELP_IMAGE_BASE}/${c.imageUrl}`
								: "";
							return (
								<article key={String(c.id)} className="card hover">
									<div
										style={{
											display: "flex",
											gap: "0.85rem",
											alignItems: "flex-start",
										}}
									>
										{imageSrc && publicAssetExists(imageSrc) ? (
											<img
												src={imageSrc}
												alt=""
												width={48}
												height={48}
												style={{ flexShrink: 0, objectFit: "contain" }}
											/>
										) : null}
										<div style={{ flex: 1, minWidth: 0 }}>
											<h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem" }}>
												{c.name}
											</h3>
											<p className="muted" style={{ margin: 0 }}>
												{c.content}
											</p>
											{c.buttonUrl && c.buttonText ? (
												<div style={{ marginTop: "0.85rem" }}>
													{isExternal(c.buttonUrl) ? (
														<a
															className="btn btn-outline"
															href={c.buttonUrl}
															target="_blank"
															rel="noreferrer"
															style={{
																background: c.buttonColor,
																borderColor: c.buttonBorderColor,
																color: "#3a2c05",
															}}
														>
															{c.buttonText}
														</a>
													) : (
														<Link
															className="btn btn-outline"
															href={c.buttonUrl}
															style={{
																background: c.buttonColor,
																borderColor: c.buttonBorderColor,
																color: "#3a2c05",
															}}
														>
															{c.buttonText}
														</Link>
													)}
												</div>
											) : null}
										</div>
									</div>
								</article>
							);
						})}
					</div>
				)}
			</ContentCard>

			<ContentCard
				icon="📜"
				title={t("rulesTitle")}
				subtitle={t("rulesSubtitle")}
				padded={ruleCategories.length === 0}
			>
				{ruleCategories.length === 0 ? (
					<EmptyState icon="📜">{t("rulesEmpty")}</EmptyState>
				) : (
					<div style={{ display: "grid", gap: "1rem", padding: "1rem" }}>
						{ruleCategories.map((cat) => {
							const catRules = rulesByCategory.get(String(cat.id)) ?? [];
							return (
								<article key={String(cat.id)} className="card">
									<div
										style={{
											display: "flex",
											alignItems: "baseline",
											gap: "0.6rem",
											flexWrap: "wrap",
										}}
									>
										<h3 style={{ margin: 0, fontSize: "1.05rem" }}>
											{cat.name}
										</h3>
										{cat.badge ? (
											<span className="muted">{cat.badge}</span>
										) : null}
									</div>
									{cat.description ? (
										<p className="muted" style={{ margin: "0.35rem 0 0" }}>
											{cat.description}
										</p>
									) : null}

									{catRules.length === 0 ? (
										<p className="muted" style={{ marginBottom: 0 }}>
											{t("categoryEmpty")}
										</p>
									) : (
										<ul
											style={{ margin: "0.85rem 0 0", paddingLeft: "1.2rem" }}
										>
											{catRules.map((r) => (
												<li
													key={String(r.id)}
													style={{ marginBottom: "0.5rem" }}
												>
													{r.paragraph ? (
														<strong style={{ marginRight: "0.4rem" }}>
															{r.paragraph}
														</strong>
													) : null}
													{r.rule}
												</li>
											))}
										</ul>
									)}
								</article>
							);
						})}
					</div>
				)}
			</ContentCard>
		</section>
	);
}
