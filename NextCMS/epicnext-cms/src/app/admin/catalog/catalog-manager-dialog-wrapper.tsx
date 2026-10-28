"use client";

import dynamic from "next/dynamic";

export const CatalogManagerDialog = dynamic(
	() =>
		import("@/components/admin/catalog-manager/catalog-manager-dialog").then(
			(m) => ({
				default: m.CatalogManagerDialog,
			}),
		),
	{ ssr: false },
);

export const CatalogManagerWorkspace = dynamic(
	() =>
		import("@/components/admin/catalog-manager/catalog-manager-dialog").then(
			(m) => ({ default: m.CatalogManagerWorkspace }),
		),
	{ ssr: false },
);
