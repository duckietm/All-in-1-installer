"use client";

import {
	BadgeCheck,
	Cat,
	ChevronDown,
	ClipboardCheck,
	Copy,
	Dumbbell,
	FileX2,
	Image as ImageIcon,
	type LucideIcon,
	Puzzle,
	RefreshCw,
	Shirt,
	Upload,
	Wrench,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CatalogManagerDialog } from "@/app/admin/catalog/catalog-manager-dialog-wrapper";
import { OrganizeImportsLauncher } from "@/components/admin/studio/organize-imports-launcher";
import Link from "@/components/link";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type StudioLink = { href: string; labelKey: string; icon: LucideIcon };
const assets: StudioLink[] = [
	{ href: "/admin/studio/furni", labelKey: "furniture", icon: Puzzle },
	{ href: "/admin/studio/badges", labelKey: "badges", icon: BadgeCheck },
	{ href: "/admin/studio/clothing", labelKey: "clothing", icon: Shirt },
	{ href: "/admin/studio/effects", labelKey: "effects", icon: Dumbbell },
	{ href: "/admin/studio/pets", labelKey: "pets", icon: Cat },
];
const imports: StudioLink[] = [
	{ href: "/admin/studio/upload", labelKey: "uploadFiles", icon: Upload },
	{ href: "/admin/studio/clone", labelKey: "importFromSource", icon: Copy },
	{ href: "/admin/studio/sync", labelKey: "syncRepository", icon: RefreshCw },
];
const maintenance: StudioLink[] = [
	{
		href: "/admin/studio/audit",
		labelKey: "catalogAudit",
		icon: ClipboardCheck,
	},
	{
		href: "/admin/studio/repair-icons",
		labelKey: "repairIcons",
		icon: ImageIcon,
	},
	{
		href: "/admin/studio/maintenance",
		labelKey: "catalogMaintenance",
		icon: Wrench,
	},
	{
		href: "/admin/studio/nitro-cleanup",
		labelKey: "nitroCleanup",
		icon: FileX2,
	},
];
const activePath = (path: string, href: string) =>
	path === href || path.startsWith(`${href}/`);

function StudioMenu({
	label,
	links,
	pathname,
}: {
	label: string;
	links: StudioLink[];
	pathname: string;
}) {
	const t = useTranslations("admin.studio");
	const [open, setOpen] = useState(false);
	const active = links.find((link) => activePath(pathname, link.href));
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				className={cn(
					"flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium",
					active
						? "bg-[var(--admin-accent)]/10 text-[var(--admin-text)]"
						: "text-[var(--admin-text-muted)] hover:bg-[var(--admin-accent)]/10",
				)}
			>
				{label}
				<ChevronDown size={14} />
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="w-64 border-[var(--admin-border)] bg-[var(--admin-surface)] p-1.5 text-[var(--admin-text)]"
			>
				{links.map(({ href, labelKey, icon: Icon }) => (
					<Link
						key={href}
						href={href}
						style={{
							color: activePath(pathname, href)
								? "var(--admin-text)"
								: "var(--admin-text-muted)",
						}}
						onClick={() => setOpen(false)}
						aria-current={activePath(pathname, href) ? "page" : undefined}
						className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm hover:bg-[var(--admin-accent)]/10 aria-[current=page]:bg-[var(--admin-accent)]/15"
					>
						<Icon size={16} aria-hidden />
						{t(`nav.${labelKey}`)}
					</Link>
				))}
			</PopoverContent>
		</Popover>
	);
}

export function StudioLayoutClient({
	canEditCatalog,
	children,
}: {
	canEditCatalog: boolean;
	children: React.ReactNode;
}) {
	const pathname = usePathname() ?? "";
	const t = useTranslations("admin.studio");
	return (
		<div className="flex h-[calc(100dvh-7rem)] min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--admin-border)] bg-[var(--admin-canvas)] text-[var(--admin-text)] sm:min-h-[600px]">
			<nav
				aria-label={t("nav.ariaLabel")}
				className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--admin-border)] bg-[var(--admin-surface)] p-2"
			>
				<div className="flex shrink-0 gap-1">
					{assets.map(({ href, labelKey, icon: Icon }) => (
						<Link
							key={href}
							href={href}
							style={{
								color: activePath(pathname, href)
									? "var(--admin-accent-foreground)"
									: "var(--admin-text-muted)",
							}}
							aria-current={activePath(pathname, href) ? "page" : undefined}
							className={cn(
								"flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors",
								activePath(pathname, href)
									? "bg-[var(--admin-accent)] text-[var(--admin-accent-foreground)]"
									: "text-[var(--admin-text-muted)] hover:bg-[var(--admin-accent)]/10",
							)}
						>
							<Icon size={16} aria-hidden />
							{t(`nav.${labelKey}`)}
						</Link>
					))}
				</div>
				<div className="ml-auto flex shrink-0 gap-1 pl-1">
					{canEditCatalog && (
						<>
							<CatalogManagerDialog
								catalogType="normal"
								canEdit
								triggerLabel={t("nav.catalogManager")}
							/>
							<OrganizeImportsLauncher />
						</>
					)}
					<StudioMenu
						label={t("nav.importSync")}
						links={imports}
						pathname={pathname}
					/>
					<StudioMenu
						label={t("nav.maintenance")}
						links={maintenance}
						pathname={pathname}
					/>
				</div>
			</nav>
			<div className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
		</div>
	);
}
