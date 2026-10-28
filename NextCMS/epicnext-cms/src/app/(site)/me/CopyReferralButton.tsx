"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

export default function CopyReferralButton({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	const [failed, setFailed] = useState(false);
	const t = useTranslations("pages.myDashboard");

	async function copy() {
		setFailed(false);
		setCopied(false);
		const absolute =
			typeof window !== "undefined" && value.startsWith("/")
				? `${window.location.origin}${value}`
				: value;
		try {
			await navigator.clipboard.writeText(absolute);
		} catch {
			const ta = document.createElement("textarea");
			ta.value = absolute;
			ta.style.position = "fixed";
			ta.style.opacity = "0";
			document.body.appendChild(ta);
			ta.select();
			try {
				if (!document.execCommand("copy")) throw new Error("copy-failed");
			} catch {
				setFailed(true);
				document.body.removeChild(ta);
				return;
			}
			document.body.removeChild(ta);
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<>
			<button
				type="button"
				onClick={copy}
				className="rounded-xl font-bold text-sm px-5 py-2.5 transition-all duration-200 hover:scale-[1.02] active:scale-95 shrink-0"
				style={{
					background:
						"color-mix(in srgb, var(--color-primary) 12%, transparent)",
					color: "var(--color-primary-readable, var(--color-primary))",
					border: `2px solid color-mix(in srgb, var(--color-primary) 20%, transparent)`,
				}}
			>
				{copied ? t("copied") : t("copy")}
			</button>
			{failed && <p role="alert">{t("copyFailed")}</p>}
		</>
	);
}
