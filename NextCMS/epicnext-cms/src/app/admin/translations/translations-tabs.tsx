"use client";

import { Gamepad2, Globe, Server } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "@/components/link";
import { cn } from "@/lib/utils";

export function TranslationsTabs() {
	const t = useTranslations("pages.admin.translations.tabs");
	const pathname = usePathname();

	const TABS = [
		{ href: "/admin/translations/cms", label: t("cms"), icon: Globe },
		{ href: "/admin/translations/client", label: t("client"), icon: Gamepad2 },
		{
			href: "/admin/translations/emulator",
			label: t("emulator"),
			icon: Server,
		},
	] as const;

	return (
		<div className="flex gap-1 border-b">
			{TABS.map((tab) => {
				const active =
					pathname === tab.href || pathname.startsWith(`${tab.href}/`);
				const Icon = tab.icon;
				return (
					<Link
						key={tab.href}
						href={tab.href}
						className={cn(
							"-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors",
							active
								? "border-primary text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						<Icon className="h-4 w-4" />
						{tab.label}
					</Link>
				);
			})}
		</div>
	);
}
