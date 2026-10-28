"use client";
import { useTranslations } from "next-intl";
import Link from "@/components/link";
import type { PublicationIssue } from "@/lib/publication-preflight";
export function PublicationPreflight({
	issues,
	paths,
}: {
	issues: PublicationIssue[];
	paths: string[];
}) {
	const t = useTranslations("pages.admin.publicationPreflight");
	return (
		<section
			className="rounded-lg border border-[var(--admin-border)] p-4 space-y-2"
			aria-label={t("title")}
		>
			<h3 className="font-semibold">{t("title")}</h3>
			<p className="text-xs text-muted-foreground">{t("description")}</p>
			{issues.length ? (
				<ul className="space-y-1 text-sm">
					{issues.map((issue) => (
						<li
							key={issue.code}
							className={
								issue.severity === "error"
									? "text-destructive"
									: "text-muted-foreground"
							}
						>
							{t(issue.code)}
						</li>
					))}
				</ul>
			) : (
				<p className="text-sm">{t("ready")}</p>
			)}
			<p className="text-xs font-medium">{t("affectedPages")}</p>
			<div className="flex flex-wrap gap-3 text-sm">
				{paths.map((path) => (
					<Link
						key={path}
						href={path}
						target="_blank"
						rel="noopener noreferrer"
						className="underline break-all"
					>
						{path}
					</Link>
				))}
			</div>
			<p className="text-xs text-muted-foreground">{t("previewHint")}</p>
		</section>
	);
}
