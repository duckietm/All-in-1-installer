import { count, desc, eq, gte } from "drizzle-orm";
import { AlertTriangle, Database, HeartPulse, Server } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchOpsHealth } from "@/lib/admin/ops-health";
import { db, EmulatorErrors, EmulatorSettings } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { HealthCheckClient } from "./health-check-client";

async function getDevOpsData() {
	const now = Math.floor(Date.now() / 1000);
	const dayAgo = now - 86400;

	const [health, recentErrors, errorsTodayRows, emuVersionRows] =
		await Promise.all([
			fetchOpsHealth(),
			db
				.select()
				.from(EmulatorErrors)
				.orderBy(desc(EmulatorErrors.id))
				.limit(20),
			db
				.select({ total: count() })
				.from(EmulatorErrors)
				.where(gte(EmulatorErrors.timestamp, dayAgo)),
			db
				.select({ value: EmulatorSettings.value })
				.from(EmulatorSettings)
				.where(eq(EmulatorSettings.key, "version"))
				.limit(1),
		]);

	return {
		dbStatus: health.dbOk ? ("healthy" as const) : ("error" as const),
		dbLatency: health.dbLatencyMs,
		redisOk: health.redisOk,
		recentErrors,
		errorsToday: Number(errorsTodayRows[0]?.total ?? 0),
		emuVersion: emuVersionRows[0]?.value ?? "Unknown",
		onlineUsers: health.onlineUsers,
	};
}

export default async function DevOpsPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.DEVOPS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.devops");
	const data = await getDevOpsData();
	const performance = await getTranslations("pages.admin.performance");
	const deliveries = await getTranslations("pages.admin.deliveries");
	const installation = await getTranslations("pages.admin.installation");

	return (
		<div className="space-y-6">
			<a href="/admin/devops/cms-errors" className="btn btn-outline">
				{t("cmsErrors")}
			</a>
			<Link href="/admin/devops/installation" className="btn btn-outline">
				{installation("title")}
			</Link>
			<Link href="/admin/devops/performance" className="btn btn-outline">
				{performance("title")}
			</Link>
			<Link href="/admin/devops/deliveries" className="btn btn-outline">
				{deliveries("title")}
			</Link>
			<Link href="/admin/devops/antiddos" className="btn btn-outline">
				Anti-DDoS protection
			</Link>
			{/* Status cards */}
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Database</CardTitle>
						<Database className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<Badge
							variant={data.dbStatus === "healthy" ? "default" : "destructive"}
						>
							{data.dbStatus === "healthy" ? "Healthy" : "Error"}
						</Badge>
						<p className="text-xs text-muted-foreground mt-1">
							Latency: {data.dbLatency}ms
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Redis</CardTitle>
						<Server className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<Badge
							variant={
								data.redisOk === false
									? "destructive"
									: data.redisOk === true
										? "default"
										: "secondary"
							}
						>
							{data.redisOk === true
								? "Healthy"
								: data.redisOk === false
									? "Error"
									: "Not configured"}
						</Badge>
						<p className="text-xs text-muted-foreground mt-1">
							Cache / rate limits / sessions
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Emulator</CardTitle>
						<Server className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<HealthCheckClient />
						<p className="text-xs text-muted-foreground mt-1">
							Version: {data.emuVersion}
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Online Users</CardTitle>
						<HeartPulse className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{data.onlineUsers}</div>
						<p className="text-xs text-muted-foreground mt-1">
							<Link
								href="/admin/commandocentrum#online"
								className="text-[var(--admin-accent)] underline-offset-2 hover:underline"
							>
								Live roster in CommandoCentrum
							</Link>
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Errors (24h)</CardTitle>
						<AlertTriangle className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{data.errorsToday}</div>
						<p className="text-xs text-muted-foreground">
							Emulator errors today
						</p>
					</CardContent>
				</Card>
			</div>

			{/* Recent errors */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<AlertTriangle className="h-4 w-4" /> Recent Emulator Errors
					</CardTitle>
				</CardHeader>
				<CardContent>
					{data.recentErrors.length === 0 ? (
						<div className="admin-empty">{t("noRecentErrors")}</div>
					) : (
						<div className="space-y-2 max-h-[500px] overflow-y-auto">
							{data.recentErrors.map((error) => (
								<div key={error.id} className="rounded-md border p-3 text-sm">
									<div className="flex items-center justify-between mb-1">
										<span className="font-mono text-xs text-muted-foreground">
											#{error.id}
										</span>
										<span className="text-xs text-muted-foreground">
											{formatDate(new Date(error.timestamp * 1000))}
										</span>
									</div>
									<pre className="text-xs whitespace-pre-wrap break-all font-mono text-destructive">
										{Buffer.from(error.stacktrace).toString("utf-8")}
									</pre>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
