"use client";
import { useTranslations } from "next-intl";

export function PublicLoadError({ href }: { href: string }) {
	const t = useTranslations("publicData");
	return (
		<div role="alert" className="flex flex-wrap items-center gap-3">
			<p>{t("loadError")}</p>
			<a href={href} className="btn btn-outline">
				{t("retry")}
			</a>
		</div>
	);
}
