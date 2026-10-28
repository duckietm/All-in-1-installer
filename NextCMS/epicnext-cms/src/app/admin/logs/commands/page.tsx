import { loadCommandLogList } from "../_lib/load-ignored-logs";
import { CommandsTable } from "./commands-table";

export default async function CommandLogsPage({
	searchParams,
}: {
	params: Promise<{ locale: string }>;
	searchParams: Promise<Record<string, string>>;
}) {
	const result = await loadCommandLogList({ searchParams, defaultPerPage: 50 });

	return (
		<div className="space-y-6">
			<CommandsTable
				data={{
					rows: result.rows,
					total: result.total,
					page: result.page,
					perPage: result.perPage,
					lastPage: result.lastPage,
				}}
			/>
		</div>
	);
}
