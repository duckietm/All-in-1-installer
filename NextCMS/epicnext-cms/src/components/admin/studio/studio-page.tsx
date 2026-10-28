import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AdminPageShell } from "@/components/admin/admin-page-shell";

interface StudioPageProps {
	icon?: LucideIcon;
	title: string;
	subtitle?: string;
	actions?: ReactNode;
	children: ReactNode;
}

/**
 * Consistent chrome for Catalog Studio sub-pages: the shared admin page
 * header (icon tile, title, subtitle, optional actions) with the studio's
 * standard padding, so every tool page lines up the same way.
 */
export function StudioPage({
	icon,
	title,
	subtitle,
	actions,
	children,
}: StudioPageProps) {
	return (
		<div className="p-3 sm:p-4">
			<AdminPageShell
				icon={icon}
				title={title}
				subtitle={subtitle}
				actions={actions}
			>
				{children}
			</AdminPageShell>
		</div>
	);
}
