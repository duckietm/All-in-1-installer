import { loadChatLogList } from "../_lib/load-ignored-logs";
import { ChatTable } from "./chat-table";

export default async function ChatLogsPage({
	searchParams,
}: {
	params: Promise<{ locale: string }>;
	searchParams: Promise<Record<string, string>>;
}) {
	const result = await loadChatLogList({ searchParams, defaultPerPage: 50 });

	return (
		<div className="space-y-6">
			<ChatTable
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
