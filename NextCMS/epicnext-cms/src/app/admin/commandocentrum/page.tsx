import os from "node:os";
import { count, desc, inArray } from "drizzle-orm";
import { Terminal } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import {
	DiagnosticRow,
	InfoItem,
	OnlineUsersWidget,
	StatusCard,
} from "@/components/admin/dashboard";
import { OperationsInbox } from "@/components/admin/operations-inbox";
import Link from "@/components/link";
import { env } from "@/env";
import { fetchOpsHealth } from "@/lib/admin/ops-health";
import { fetchOpsOnlineUsers } from "@/lib/admin/ops-online-users";
import { db, EmulatorErrors, StaffActivities, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";
import { CommandocentrumControls } from "./commandocentrum-controls";
import { RefreshStatus } from "./refresh-status";

function decodeStacktrace(raw: unknown): string {
	if (raw == null) return "";
	try {
		if (typeof raw === "string") return raw;
		return Buffer.from(raw as Uint8Array).toString("utf8");
	} catch {
		return "";
	}
}

function mb(bytes: number): string {
	return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function uptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default async function CommandoCentrum() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.RCON_EXECUTE, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.commandocentrum");

	const [
		totalUsersRows,
		errorRows,
		health,
		maintenance,
		activity,
		onlineRoster,
	] = await Promise.all([
		db
			.select({ total: count() })
			.from(User)
			.catch(() => [{ total: -1 }]),
		db
			.select()
			.from(EmulatorErrors)
			.orderBy(desc(EmulatorErrors.timestamp))
			.limit(50)
			.catch(() => null),
		fetchOpsHealth(),
		siteSettings.getBool("maintenance_enabled", false),
		db
			.select()
			.from(StaffActivities)
			.orderBy(desc(StaffActivities.createdAt))
			.limit(12)
			.catch(() => [] as (typeof StaffActivities.$inferSelect)[]),
		fetchOpsOnlineUsers(40),
	]);
	const errors = errorRows ?? [];
	const errorsAvailable = errorRows !== null;
	const totalUsers = Number(totalUsersRows[0]?.total ?? -1);

	const dbOk = health.dbOk;
	const redisOk = health.redisOk;
	const emulatorOnline = health.emulatorOk;
	const onlineCount = onlineRoster.count;
	const onlineUsers = onlineRoster.users;

	const staffIds = Array.from(
		new Set(activity.map((a) => Number(a.userId))),
	).filter((n) => n > 0);
	let nameById = new Map<number, string>();
	if (staffIds.length) {
		const users = await db
			.select({ id: User.id, username: User.username })
			.from(User)
			.where(inArray(User.id, staffIds))
			.catch(() => []);
		nameById = new Map(users.map((u) => [u.id, u.username]));
	}

	const appKeySet = !!process.env.APP_KEY;
	const smtpSet = !!(env.SMTP_HOST || env.RESEND_API_KEY);
	const rconSet =
		env.EMULATOR_MODE === "api" ? !!env.EMULATOR_API_URL : !!env.RCON_HOST;

	return (
		<AdminPageShell icon={Terminal} title={t("title")} subtitle={t("subtitle")}>
			<div className="min-w-0">
				<div className="mb-4 flex flex-wrap items-center gap-3">
					<p className="text-sm">
						{dbOk && emulatorOnline && redisOk !== false
							? t("servicesHealthy")
							: t("serviceAttention")}{" "}
						·{" "}
						{t("checkedAt", {
							time: formatDate(new Date(), "datetime-seconds"),
						})}
					</p>
					<RefreshStatus label={t("refreshStatus")} />
					{canAccess(permissions, PERMS.DEVOPS_VIEW, session.user.rank) ? (
						<Link href="/admin/devops/cms-errors" className="btn btn-outline">
							{t("cmsErrors")}
						</Link>
					) : null}
				</div>
				<OperationsInbox />
				{/* ── Live status ────────────────────────────────────────── */}
				<div
					className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6"
					style={{ marginTop: "1.1rem" }}
				>
					<StatusCard
						label={t("playersOnline")}
						value={dbOk ? onlineCount : "—"}
						hint={
							totalUsers >= 0
								? t("totalAccounts", { count: totalUsers })
								: t("dbUnavailable")
						}
						state="neutral"
						icon="👤"
					/>
					<StatusCard
						label={t("emulator")}
						value={emulatorOnline ? t("online") : t("offline")}
						hint={emulatorOnline ? t("rconReachable") : t("rconNotResponding")}
						state={emulatorOnline ? "ok" : "danger"}
						icon="🎮"
					/>
					<StatusCard
						label={t("database")}
						value={dbOk ? t("connected") : t("down")}
						hint={dbOk ? t("queriesResponding") : t("cannotReachDb")}
						state={dbOk ? "ok" : "danger"}
						icon="🗄️"
					/>
					<StatusCard
						label={t("emulatorErrors")}
						value={errorsAvailable ? errors.length : "—"}
						hint={errorsAvailable ? t("last50Logged") : t("readFailed")}
						state={errorsAvailable && errors.length === 0 ? "ok" : "warn"}
						icon="⚠️"
					/>
				</div>

				<CommandocentrumControls />

				{/* ── Online users widget ───────────────────────────────── */}
				<section id="online" className="admin-card mb-6 scroll-mt-4">
					<h2 className="admin-section-title">{t("onlineUsers")}</h2>
					<OnlineUsersWidget users={onlineUsers} isLoading={false} />
				</section>

				{/* ── Server info + diagnostics ──────────────────────────── */}
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					<details className="admin-card p-5 self-start">
						<summary className="admin-section-title cursor-pointer">
							{t("serverInfo")}
						</summary>
						<div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
							<InfoItem label={t("node")} value={process.version} />
							<InfoItem
								label={t("platform")}
								value={`${process.platform} ${process.arch}`}
							/>
							<InfoItem
								label={t("appUptime")}
								value={uptime(process.uptime())}
							/>
							<InfoItem
								label={t("heapUsed")}
								value={mb(process.memoryUsage().heapUsed)}
							/>
							<InfoItem
								label={t("rss")}
								value={mb(process.memoryUsage().rss)}
							/>
							<InfoItem label={t("hostUptime")} value={uptime(os.uptime())} />
							<InfoItem
								label={t("load1m")}
								value={os.loadavg()[0]?.toFixed(2) ?? "—"}
							/>
							<InfoItem label={t("cpus")} value={os.cpus().length} />
						</div>
					</details>

					<section className="admin-card p-5">
						<h2 className="admin-section-title">{t("systemDiagnostics")}</h2>
						<div className="flex flex-col">
							<DiagnosticRow
								label={t("database")}
								detail={dbOk ? t("connectionHealthy") : t("unreachable")}
								state={dbOk ? "ok" : "danger"}
							/>
							<DiagnosticRow
								label="Redis"
								detail={
									redisOk === true
										? "PONG"
										: redisOk === false
											? "Unreachable"
											: "REDIS_URL not configured"
								}
								state={
									redisOk === true
										? "ok"
										: redisOk === false
											? "danger"
											: "warn"
								}
							/>
							<DiagnosticRow
								label={t("emulatorRcon")}
								detail={
									emulatorOnline ? t("respondingToPing") : t("noResponse")
								}
								state={emulatorOnline ? "ok" : "warn"}
							/>
							<DiagnosticRow
								label={t("emulatorConfig")}
								detail={rconSet ? t("configured") : t("notConfigured")}
								state={rconSet ? "ok" : "warn"}
							/>
							<DiagnosticRow
								label={t("twoFaEncryptionKey")}
								detail={appKeySet ? t("appKeyConfigured") : t("appKeyMissing")}
								state={appKeySet ? "ok" : "warn"}
							/>
							<DiagnosticRow
								label={t("emailConfig")}
								detail={smtpSet ? t("configured") : t("notConfigured")}
								state={smtpSet ? "ok" : "warn"}
							/>
							<DiagnosticRow
								label={t("maintenanceMode")}
								detail={
									maintenance ? t("siteIsInMaintenance") : t("siteIsLive")
								}
								state={maintenance ? "warn" : "ok"}
							/>
						</div>
					</section>
				</div>

				{/* ── Staff activity ─────────────────────────────────────── */}
				<section className="mt-6">
					<h2 className="admin-section-title">{t("recentStaffActivity")}</h2>
					{activity.length === 0 ? (
						<div className="admin-empty">{t("noStaffActivity")}</div>
					) : (
						<div className="admin-card overflow-x-auto">
							<table>
								<thead>
									<tr>
										<th>{t("colWhen")}</th>
										<th>{t("colStaff")}</th>
										<th>{t("colAction")}</th>
										<th>{t("colDescription")}</th>
									</tr>
								</thead>
								<tbody>
									{activity.map((a) => (
										<tr key={String(a.id)}>
											<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
												{formatDate(a.createdAt, "datetime-seconds")}
											</td>
											<td>
												{nameById.get(Number(a.userId)) ?? `#${a.userId}`}
											</td>
											<td>
												<span className="inline-block text-[0.6rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-accent)]/18 text-[var(--admin-text)]">
													{a.action}
												</span>
											</td>
											<td className="text-sm theme-text-muted dark:theme-text-muted">
												{a.description}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>

				{/* ── Emulator errors ────────────────────────────────────── */}
				<section className="mt-6">
					<h2 className="admin-section-title">{t("recentEmulatorErrors")}</h2>
					{!errorsAvailable ? (
						<div className="admin-empty">{t("readFailed")}</div>
					) : errors.length === 0 ? (
						<div className="admin-empty">{t("noEmulatorErrors")}</div>
					) : (
						<div className="admin-card overflow-x-auto">
							<table>
								<thead>
									<tr>
										<th>{t("colWhen")}</th>
										<th>{t("colType")}</th>
										<th>{t("colVersion")}</th>
										<th>{t("colStacktrace")}</th>
									</tr>
								</thead>
								<tbody>
									{errors.map((e) => {
										const trace = decodeStacktrace(e.stacktrace);
										const snippet = trace
											? trace.split("\n").slice(0, 20).join("\n") +
												(trace.split("\n").length > 20
													? `\n… ${t("truncated")}`
													: "")
											: t("empty");
										return (
											<tr key={e.id}>
												<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
													{formatDate(
														e.timestamp ? new Date(e.timestamp * 1000) : null,
														"datetime-seconds",
													)}
												</td>
												<td>{e.type}</td>
												<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
													{e.version}
												</td>
												<td>
													<details>
														<summary className="cursor-pointer text-xs">
															{trace.split("\n")[0]?.slice(0, 120) ||
																t("empty")}
														</summary>
														<pre className="text-xs p-2 bg-[var(--admin-canvas)] text-[var(--color-text-readable)] rounded overflow-auto max-h-[160px]">
															{snippet}
														</pre>
													</details>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</div>
		</AdminPageShell>
	);
}
