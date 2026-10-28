"use client";

import { FolderTree } from "lucide-react";
import { useTranslations } from "next-intl";
import { lazy, Suspense, useState } from "react";
import { StudioPanelLoading } from "./studio-panel-loading";

const OrganizeImportsDialog = lazy(() =>
	import("./organize-imports-dialog").then((module) => ({
		default: module.OrganizeImportsDialog,
	})),
);

export function OrganizeImportsLauncher() {
	const t = useTranslations("pages.admin.catalog.workspace.organizeImports");
	const [open, setOpen] = useState(false);
	const [requested, setRequested] = useState(false);
	return (
		<>
			<button
				type="button"
				onClick={() => {
					setRequested(true);
					setOpen(true);
				}}
				className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[var(--admin-text-muted)] hover:bg-[var(--admin-accent)]/10"
			>
				<FolderTree size={16} />
				{t("title")}
			</button>
			{requested && (
				<Suspense
					fallback={
						open ? <StudioPanelLoading onClose={() => setOpen(false)} /> : null
					}
				>
					<OrganizeImportsDialog open={open} onOpenChange={setOpen} />
				</Suspense>
			)}
		</>
	);
}
