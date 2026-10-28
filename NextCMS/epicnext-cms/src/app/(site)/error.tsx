"use client";

import { Home, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ErrorScreen } from "@/components/error-screen";
import Link from "@/components/link";
import { reportBrowserError } from "@/lib/browser-errors";

/**
 * Site route-segment error boundary. Renders inside the site shell layout.
 * Never shows the raw error to the user.
 */
export default function SiteErrorPage({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const t = useTranslations("pages.error");

	const [reference, setReference] = useState(error.digest);
	useEffect(() => {
		setReference(error.digest ?? reportBrowserError(error, "browser.boundary"));
		if (error.digest) reportBrowserError(error, "browser.boundary");
	}, [error]);

	return (
		<ErrorScreen
			code={t("code")}
			title={t("title")}
			subtitle={t("subtitle")}
			body={t("body")}
			actions={
				<>
					<button
						type="button"
						className="btn btn-primary"
						onClick={() => reset()}
					>
						<RefreshCw className="error-screen-btn-icon" aria-hidden />
						{t("tryAgain")}
					</button>
					<Link className="btn btn-outline" href="/">
						<Home className="error-screen-btn-icon" aria-hidden />
						{t("backHome")}
					</Link>
				</>
			}
			footer={
				reference ? (
					<p className="error-screen-digest">
						{t("reference", { digest: reference })}
					</p>
				) : null
			}
		/>
	);
}
