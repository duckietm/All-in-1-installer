import { ChevronRight, Home } from "lucide-react";
import { Fragment } from "react";
import Link from "@/components/link";

export type { BreadcrumbItem } from "@/types/common";

import type { BreadcrumbItem } from "@/types/common";

interface AdminBreadcrumbProps {
	items: BreadcrumbItem[];
}

export function AdminBreadcrumb({ items }: AdminBreadcrumbProps) {
	return (
		<nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-2">
			<Link href="/admin" className="hover:text-foreground transition-colors">
				<Home className="h-3.5 w-3.5" />
			</Link>
			{items.map((item) => (
				<Fragment key={item.href ?? item.label}>
					<ChevronRight className="h-3 w-3 flex-shrink-0" />
					{item.href ? (
						<Link
							href={item.href}
							className="hover:text-foreground transition-colors"
						>
							{item.label}
						</Link>
					) : (
						<span className="text-foreground font-medium">{item.label}</span>
					)}
				</Fragment>
			))}
		</nav>
	);
}
