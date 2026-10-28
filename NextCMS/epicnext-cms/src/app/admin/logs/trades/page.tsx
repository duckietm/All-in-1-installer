import { loadTradeLogList } from "../_lib/load-ignored-logs";
import { TradesTable } from "./trades-table";

export default async function TradeLogsPage({
	searchParams,
}: {
	params: Promise<{ locale: string }>;
	searchParams: Promise<Record<string, string>>;
}) {
	const result = await loadTradeLogList({ searchParams, defaultPerPage: 50 });

	return (
		<div className="space-y-6">
			<TradesTable
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
