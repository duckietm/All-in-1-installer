import { desc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { deleteShout } from "@/actions/admin-radio-moderation";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { db, RadioApplications, RadioSchedules, RadioShouts } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

type Shout = {
	id: bigint;
	userId: bigint;
	message: string;
	createdAt: Date | null;
};

type Application = {
	id: bigint;
	userId: bigint;
	realName: string;
	age: number;
	status: string;
	musicStyle: string | null;
	discordUsername: string | null;
	createdAt: Date | null;
};

type Schedule = {
	id: bigint;
	userId: bigint;
	day: string;
	startTime: Date;
	endTime: Date;
	showName: string | null;
	isActive: boolean;
};

function formatTime(d: Date | null): string {
	return d ? d.toISOString().slice(11, 16) : "\u2014";
}

function statusBadgeClass(status: string): string {
	const s = status.toLowerCase();
	if (s === "approved" || s === "accepted") return "ok";
	if (s === "rejected" || s === "denied") return "danger";
	return "";
}

export default async function AdminRadioPage() {
	const t = await getTranslations("pages.admin.radio");

	let shouts: Shout[] = [];
	let applications: Application[] = [];
	let schedules: Schedule[] = [];

	try {
		shouts = await db
			.select({
				id: RadioShouts.id,
				userId: RadioShouts.userId,
				message: RadioShouts.message,
				createdAt: RadioShouts.createdAt,
			})
			.from(RadioShouts)
			.orderBy(desc(RadioShouts.id))
			.limit(25);
	} catch {
		shouts = [];
	}

	try {
		applications = await db
			.select({
				id: RadioApplications.id,
				userId: RadioApplications.userId,
				realName: RadioApplications.realName,
				age: RadioApplications.age,
				status: RadioApplications.status,
				musicStyle: RadioApplications.musicStyle,
				discordUsername: RadioApplications.discordUsername,
				createdAt: RadioApplications.createdAt,
			})
			.from(RadioApplications)
			.orderBy(desc(RadioApplications.id))
			.limit(25);
	} catch {
		applications = [];
	}

	try {
		schedules = await db
			.select({
				id: RadioSchedules.id,
				userId: RadioSchedules.userId,
				day: RadioSchedules.day,
				startTime: RadioSchedules.startTime,
				endTime: RadioSchedules.endTime,
				showName: RadioSchedules.showName,
				isActive: RadioSchedules.isActive,
			})
			.from(RadioSchedules)
			.orderBy(desc(RadioSchedules.id))
			.limit(25);
	} catch {
		schedules = [];
	}

	const pendingApps = applications.filter(
		(a) => a.status.toLowerCase() === "pending",
	).length;
	const activeSchedules = schedules.filter((sc) => sc.isActive).length;

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard label={t("shouts")} value={shouts.length} icon="📣" />
				<StatusCard
					label={t("pendingApplications")}
					value={pendingApps}
					state={pendingApps > 0 ? "warn" : "ok"}
					icon="📝"
				/>
				<StatusCard label={t("schedules")} value={schedules.length} icon="🗓️" />
				<StatusCard
					label={t("activeSchedules")}
					value={activeSchedules}
					state={activeSchedules > 0 ? "ok" : "neutral"}
					icon="🎙️"
				/>
			</div>

			<section className="mt-6">
				<h2>
					{t("shouts")} ({shouts.length})
				</h2>
				{shouts.length === 0 ? (
					<p className="text-xs theme-text-muted dark:theme-text-muted">
						{t("noShouts")}
					</p>
				) : (
					<div className="overflow-x-auto">
						<table>
							<thead>
								<tr>
									<th>ID</th>
									<th>{t("user")}</th>
									<th>{t("message")}</th>
									<th>{t("posted")}</th>
									<th />
								</tr>
							</thead>
							<tbody>
								{shouts.map((s) => (
									<tr key={String(s.id)}>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{String(s.id)}
										</td>
										<td>{String(s.userId)}</td>
										<td>{s.message}</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted">
											{formatDate(s.createdAt, "datetime", "\u2014")}
										</td>
										<td>
											<form action={deleteShout}>
												<input type="hidden" name="id" value={String(s.id)} />
												<Button type="submit" variant="destructive">
													{t("deleteShout")}
												</Button>
											</form>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<section className="mt-6">
				<h2>
					{t("applications")} ({applications.length})
				</h2>
				{applications.length === 0 ? (
					<p className="text-xs theme-text-muted dark:theme-text-muted">
						{t("noApplications")}
					</p>
				) : (
					<div className="overflow-x-auto">
						<table>
							<thead>
								<tr>
									<th>ID</th>
									<th>{t("user")}</th>
									<th>{t("realName")}</th>
									<th>{t("age")}</th>
									<th>{t("style")}</th>
									<th>Discord</th>
									<th>{t("status")}</th>
									<th>{t("applied")}</th>
								</tr>
							</thead>
							<tbody>
								{applications.map((a) => (
									<tr key={String(a.id)}>
										<td>{String(a.id)}</td>
										<td>{String(a.userId)}</td>
										<td>{a.realName}</td>
										<td>{a.age}</td>
										<td>{a.musicStyle ?? "\u2014"}</td>
										<td>{a.discordUsername ?? "\u2014"}</td>
										<td>
											<span
												className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${statusBadgeClass(a.status) === "ok" ? "bg-[var(--admin-success-subtle)] text-[var(--admin-text)]" : statusBadgeClass(a.status) === "danger" ? "bg-[var(--admin-error-subtle)] text-[var(--admin-text)]" : "bg-[var(--admin-accent)]/18 text-[var(--admin-text)]"}`}
											>
												{a.status}
											</span>
										</td>
										<td className="text-sm theme-text-muted dark:theme-text-muted">
											{formatDate(a.createdAt, "datetime", "\u2014")}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<section className="mt-6">
				<h2>
					{t("schedules")} ({schedules.length})
				</h2>
				{schedules.length === 0 ? (
					<p className="text-xs theme-text-muted dark:theme-text-muted">
						{t("noSchedules")}
					</p>
				) : (
					<div className="overflow-x-auto">
						<table>
							<thead>
								<tr>
									<th>ID</th>
									<th>{t("user")}</th>
									<th>{t("day")}</th>
									<th>{t("start")}</th>
									<th>{t("end")}</th>
									<th>{t("show")}</th>
									<th>{t("active")}</th>
								</tr>
							</thead>
							<tbody>
								{schedules.map((sc) => (
									<tr key={String(sc.id)}>
										<td>{String(sc.id)}</td>
										<td>{String(sc.userId)}</td>
										<td>{sc.day}</td>
										<td>{formatTime(sc.startTime)}</td>
										<td>{formatTime(sc.endTime)}</td>
										<td>{sc.showName ?? "\u2014"}</td>
										<td>
											<span
												className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${sc.isActive ? "bg-[var(--admin-success-subtle)] text-[var(--admin-text)]" : "bg-[var(--admin-error-subtle)] text-[var(--admin-text)]"}`}
											>
												{sc.isActive ? t("active") : t("inactive")}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</main>
	);
}
