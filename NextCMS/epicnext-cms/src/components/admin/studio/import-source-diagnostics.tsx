"use client";
import { useTranslations } from "next-intl";
import type { SourceAssetCheck } from "@/lib/furni/source-assets";
export function ImportSourceDiagnostics({
	check,
}: {
	check?: SourceAssetCheck;
}) {
	const t = useTranslations("admin.studio.importDiagnostics");
	if (!check?.attempts?.length) return null;
	return (
		<details className="mt-2 text-xs">
			<summary className="cursor-pointer">{t("attempts")}</summary>
			<p className="mt-2 text-[var(--admin-text-muted)]">{t("preliminary")}</p>
			<ul className="space-y-2 py-2">
				{[
					...new Map(
						check.attempts.map((attempt) => [attempt.url, attempt]),
					).values(),
				].map((attempt) => (
					<li key={attempt.url}>
						<strong>{attempt.file}</strong> ·{" "}
						{attempt.reason === "http"
							? t("http", { status: attempt.status ?? 0 })
							: t(attempt.reason)}
						<code className="block break-all">{attempt.url}</code>
					</li>
				))}
			</ul>
		</details>
	);
}
