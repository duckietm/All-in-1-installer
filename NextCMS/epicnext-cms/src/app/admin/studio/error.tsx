"use client";

import { LayoutDashboard, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { reportBrowserError } from "@/lib/browser-errors";

/**
 * Studio error boundary. Renders inside the admin Studio layout shell.
 * Catches runtime errors in furniture rendering, icon loading, etc.
 */
export default function StudioErrorPage({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const t = useTranslations("pages.error");
	const tNav = useTranslations("pages.admin.nav");

	const [reference, setReference] = useState(error.digest);
	useEffect(() => {
		setReference(error.digest ?? reportBrowserError(error, "studio.boundary"));
		if (error.digest) reportBrowserError(error, "studio.boundary");
	}, [error]);

	return (
		<div
			className="rounded-xl border p-8 max-w-lg mx-auto mt-8 text-center"
			style={{
				borderColor: "var(--admin-border, rgba(0,0,0,0.08))",
				background: "var(--admin-surface, #fff)",
			}}
			role="alert"
		>
			<p
				className="text-sm font-bold uppercase tracking-wider mb-2"
				style={{ color: "var(--admin-muted, #6b7280)" }}
			>
				{t("code")}
			</p>
			<h1 className="text-xl font-extrabold mb-2">{t("title")}</h1>
			<p
				className="text-sm mb-1"
				style={{ color: "var(--admin-muted, #6b7280)" }}
			>
				{t("subtitle")}
			</p>
			<p
				className="text-sm mb-6"
				style={{ color: "var(--admin-muted, #6b7280)" }}
			>
				{t("body")}
			</p>
			<div className="flex flex-wrap gap-3 justify-center">
				<Button type="button" variant="default" onClick={() => reset()}>
					<RefreshCw className="size-4" aria-hidden />
					{t("tryAgain")}
				</Button>
				<Button variant="outline" asChild>
					<Link href="/admin/studio/furni">
						<LayoutDashboard className="size-4" aria-hidden />
						{tNav("dashboard")}
					</Link>
				</Button>
			</div>
			{reference ? (
				<p
					className="mt-6 text-xs font-mono"
					style={{ color: "var(--admin-muted, #9ca3af)" }}
				>
					{t("reference", { digest: reference })}
				</p>
			) : null}
		</div>
	);
}
