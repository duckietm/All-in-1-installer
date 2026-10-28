"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

export interface StaffActivityRow {
	id: number;
	when: string;
	staff: string;
	action: string;
	description: string;
	target: string;
	ip: string;
}

export function StaffActivitiesTable({
	data,
}: {
	data: PaginatedResult<StaffActivityRow>;
}) {
	const t = useTranslations("pages.admin.logs");

	const columns: DataTableColumn<StaffActivityRow>[] = [
		{ key: "when", label: t("colWhen"), sortable: true },
		{ key: "staff", label: t("colStaff"), sortable: true },
		{
			key: "action",
			label: t("colAction"),
			sortable: true,
			render: (value) => (
				<Badge variant="secondary" className="font-mono text-[0.7rem]">
					{String(value)}
				</Badge>
			),
		},
		{ key: "description", label: t("colDescription") },
		{ key: "target", label: t("colTarget") },
		{ key: "ip", label: t("colIp") },
	];

	return (
		<DataTable
			data={data}
			columns={columns}
			searchPlaceholder={t("searchPlaceholder")}
			presets={[
				{
					label: t("authorizationErrors"),
					params: { filter_authorization: "1" },
				},
			]}
		/>
	);
}
