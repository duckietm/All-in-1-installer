import { MessageSquare, Terminal } from "lucide-react";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format-date";

interface ChatMessage {
	id: number;
	roomId: number;
	timestamp: number;
	message: string;
}

interface CommandEntry {
	id: number;
	timestamp: number;
	command: string;
	params: string;
	succes: string;
}

interface UserActivityLogProps {
	chatLogs: ChatMessage[];
	commandLogs: CommandEntry[];
}

function formatTime(ts: number) {
	if (!ts) return "-";
	return formatDate(new Date(ts * 1000));
}

export function UserActivityLog({
	chatLogs,
	commandLogs,
}: UserActivityLogProps) {
	return (
		<div className="grid gap-6 lg:grid-cols-2">
			{/* Chat Messages */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<MessageSquare className="h-4 w-4" />
						Recent Messages ({chatLogs.length})
					</CardTitle>
				</CardHeader>
				<CardContent>
					{chatLogs.length === 0 ? (
						<p className="text-sm text-muted-foreground">No recent messages.</p>
					) : (
						<div className="space-y-2 max-h-[400px] overflow-y-auto">
							{chatLogs.map((log) => (
								<div
									key={log.id}
									className="rounded-md border px-3 py-2 text-sm"
								>
									<div className="flex items-center justify-between gap-2 mb-1">
										<Link
											href={`/admin/rooms/${log.roomId}`}
											className="text-xs text-primary hover:underline"
										>
											Room #{log.roomId}
										</Link>
										<span className="text-xs text-muted-foreground">
											{formatTime(log.timestamp)}
										</span>
									</div>
									<p className="break-words">{log.message}</p>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Commands */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Terminal className="h-4 w-4" />
						Recent Commands ({commandLogs.length})
					</CardTitle>
				</CardHeader>
				<CardContent>
					{commandLogs.length === 0 ? (
						<p className="text-sm text-muted-foreground">No recent commands.</p>
					) : (
						<div className="space-y-2 max-h-[400px] overflow-y-auto">
							{commandLogs.map((log) => (
								<div
									key={log.id}
									className="rounded-md border px-3 py-2 text-sm"
								>
									<div className="flex items-center justify-between gap-2">
										<code className="font-mono text-xs font-bold">
											:{log.command}
										</code>
										<div className="flex items-center gap-2">
											<Badge
												variant={
													log.succes === "yes" ? "default" : "destructive"
												}
												className="text-[10px]"
											>
												{log.succes === "yes" ? "OK" : "FAIL"}
											</Badge>
											<span className="text-xs text-muted-foreground">
												{formatTime(log.timestamp)}
											</span>
										</div>
									</div>
									{log.params && (
										<p className="text-xs text-muted-foreground mt-1 break-words">
											{log.params}
										</p>
									)}
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
