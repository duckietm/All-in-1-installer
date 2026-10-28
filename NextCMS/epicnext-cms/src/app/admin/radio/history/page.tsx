import { desc, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { StatusCard } from "@/components/admin/dashboard";
import { db, RadioHistory, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

type History = {
	id: bigint;
	userId: bigint;
	showName: string | null;
	startedAt: Date;
	endedAt: Date | null;
	listenersCount: number;
	notes: string | null;
};

function formatDuration(start: Date, end: Date | null): string {
	if (!end) return "\u2014";
	const ms = end.getTime() - start.getTime();
	if (ms <= 0) return "\u2014";
	const mins = Math.round(ms / 60000);
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default async function AdminRadioHistoryPage() {
	const t = await getTranslations("pages.admin.radio");

	let history: History[] = [];
	let names = new Map<string, string>();
	let dbError = false;

	try {
		history = await db
			.select({
				id: RadioHistory.id,
				userId: RadioHistory.userId,
				showName: RadioHistory.showName,
				startedAt: RadioHistory.startedAt,
				endedAt: RadioHistory.endedAt,
				listenersCount: RadioHistory.listenersCount,
				notes: RadioHistory.notes,
			})
			.from(RadioHistory)
			.orderBy(desc(RadioHistory.startedAt))
			.limit(100);

		const ids = Array.from(
			new Set(history.map((h) => Number(h.userId))),
		).filter((n) => Number.isFinite(n) && n > 0);
		if (ids.length > 0) {
			const users = await db
				.select({ id: User.id, username: User.username })
				.from(User)
				.where(inArray(User.id, ids));
			names = new Map(users.map((u) => [String(u.id), u.username]));
		}
	} catch {
		dbError = true;
		history = [];
	}

	const liveCount = history.filter((h) => !h.endedAt).length;
	const peakListeners = history.reduce(
		(max, h) => Math.max(h.listenersCount, max),
		0,
	);
	const uniqueDjs = new Set(history.map((h) => String(h.userId))).size;

	return (
		<main>
			{dbError ? (
				<div className="admin-card mb-6">
					<p className="text-xs theme-text-muted dark:theme-text-muted m-0">
						{t("historyPage.dbError")}
					</p>
				</div>
			) : (
				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
					<StatusCard
						label={t("historyPage.showsLogged")}
						value={history.length}
						icon="🎙️"
					/>
					<StatusCard
						label={t("historyPage.onAirNow")}
						value={liveCount}
						state={liveCount > 0 ? "ok" : "neutral"}
						icon="🔴"
					/>
					<StatusCard
						label={t("historyPage.uniqueDjs")}
						value={uniqueDjs}
						icon="🧑‍🎤"
					/>
					<StatusCard
						label={t("historyPage.peakListeners")}
						value={peakListeners}
						icon="👥"
					/>
				</div>
			)}

			{!dbError && history.length === 0 ? (
				<div className="admin-empty">{t("historyPage.empty")}</div>
			) : null}

			{history.length > 0 ? (
				<section className="mt-6">
					<h2 className="admin-section-title">
						{t("historyPage.showLog", { count: history.length })}
					</h2>
					<table>
						<thead>
							<tr>
								<th>ID</th>
								<th>{t("historyPage.colDj")}</th>
								<th>{t("historyPage.colShow")}</th>
								<th>{t("historyPage.colStarted")}</th>
								<th>{t("historyPage.colEnded")}</th>
								<th>{t("historyPage.colAirtime")}</th>
								<th>{t("historyPage.colListeners")}</th>
								<th>{t("historyPage.colNotes")}</th>
							</tr>
						</thead>
						<tbody>
							{history.map((h) => (
								<tr key={String(h.id)}>
									<td>{String(h.id)}</td>
									<td>
										{names.get(String(h.userId)) ?? `#${String(h.userId)}`}
									</td>
									<td>{h.showName ?? "\u2014"}</td>
									<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
										{formatDate(h.startedAt, "datetime", "\u2014")}
									</td>
									<td>
										{h.endedAt ? (
											<span className="text-sm theme-text-muted dark:theme-text-muted">
												{formatDate(h.endedAt, "datetime", "\u2014")}
											</span>
										) : (
											<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-success-subtle)] text-[var(--admin-text)]">
												{t("historyPage.onAir")}
											</span>
										)}
									</td>
									<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
										{formatDuration(h.startedAt, h.endedAt)}
									</td>
									<td>{h.listenersCount}</td>
									<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
										{h.notes ?? "\u2014"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			) : null}
		</main>
	);
}
