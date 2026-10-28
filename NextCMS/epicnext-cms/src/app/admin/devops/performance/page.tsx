import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { readPerformance } from "@/lib/performance-store";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function PerformancePage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.DEVOPS_VIEW, session.user.rank))
		redirect("/admin");
	const t = await getTranslations("pages.admin.performance");
	const params = await searchParams;
	const kind = params.kind === "public-page" ? "public-page" : "admin-api";
	const { samples, shared } = await readPerformance(kind);
	const query = (typeof params.q === "string" ? params.q : "").slice(0, 100);
	const refreshParams = new URLSearchParams({
		kind,
		q: query,
		sort: params.sort === "recent" ? "recent" : "slowest",
		slow: params.slow === "1" ? "1" : "0",
	});
	const visible = samples.filter(
		(sample) =>
			`${sample.route} ${sample.operationId}`.includes(query) &&
			(params.slow !== "1" || sample.metrics.durationMs >= 1000),
	);
	visible.sort((a, b) =>
		params.sort === "recent"
			? b.at - a.at
			: b.metrics.durationMs - a.metrics.durationMs,
	);
	return (
		<div className="min-w-0 space-y-5">
			<div>
				<h1 className="text-2xl font-semibold">{t("title")}</h1>
				<p className="text-muted-foreground">{t("scope")}</p>
			</div>
			<div className="flex flex-wrap gap-3">
				<Link href="/admin/devops" className="btn btn-outline">
					DevOps
				</Link>
				<Link
					href={`/admin/devops/performance?${refreshParams}`}
					className="btn btn-outline"
				>
					{t("refresh")}
				</Link>
			</div>
			<p className="admin-card text-sm">
				{t(shared ? "shared" : "local")} {t("retention")}
			</p>
			<form className="admin-card flex flex-wrap gap-3">
				<select
					name="kind"
					defaultValue={kind}
					aria-label={t("kind")}
					className="input"
				>
					<option value="admin-api">{t("adminApi")}</option>
					<option value="public-page">{t("publicPage")}</option>
				</select>
				<input
					name="q"
					defaultValue={query}
					aria-label={t("search")}
					placeholder={t("search")}
					className="input min-w-0 flex-1"
					maxLength={100}
				/>
				<select
					name="sort"
					defaultValue={params.sort === "recent" ? "recent" : "slowest"}
					aria-label={t("sort")}
					className="input"
				>
					<option value="slowest">{t("slowest")}</option>
					<option value="recent">{t("recent")}</option>
				</select>
				<select
					name="slow"
					defaultValue={params.slow === "1" ? "1" : "0"}
					aria-label={t("threshold")}
					className="input"
				>
					<option value="0">{t("all")}</option>
					<option value="1">{t("slow")}</option>
				</select>
				<button className="btn btn-primary" type="submit">
					{t("applyFilters")}
				</button>
			</form>
			<p className="text-sm text-muted-foreground">{t("explanation")}</p>
			{kind === "public-page" && (
				<p className="text-sm text-muted-foreground">{t("publicBoundary")}</p>
			)}
			{visible.length === 0 ? (
				<p className="admin-card">{t("empty")}</p>
			) : (
				<ul className="space-y-3">
					{visible.map((sample) => (
						<li
							key={sample.operationId}
							className="admin-card min-w-0 space-y-3"
						>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="break-all font-medium">
										{sample.method} {sample.route}
									</p>
									<p className="text-sm text-muted-foreground">
										{new Date(sample.at).toISOString()} ·{" "}
										{sample.kind === "public-page"
											? t(`outcomes.${sample.outcome ?? "completed"}`)
											: `HTTP ${sample.status}`}
									</p>
								</div>
								<strong
									className={
										sample.metrics.durationMs >= 1000 ? "text-destructive" : ""
									}
								>
									{Math.round(sample.metrics.durationMs)} ms
								</strong>
							</div>
							<dl className="grid gap-3 sm:grid-cols-2">
								<div>
									<dt>{t("database")}</dt>
									<dd>
										{Math.round(sample.metrics.database.durationMs)} ms ·{" "}
										{t("calls", { count: sample.metrics.database.count })} ·{" "}
										{t("failures", { count: sample.metrics.database.errors })}
									</dd>
								</div>
								<div>
									<dt>{t("external")}</dt>
									<dd>
										{Math.round(sample.metrics.external.durationMs)} ms ·{" "}
										{t("calls", { count: sample.metrics.external.count })} ·{" "}
										{t("failures", { count: sample.metrics.external.errors })}
									</dd>
								</div>
							</dl>
							{sample.streaming && (
								<p className="text-sm text-destructive">{t("streaming")}</p>
							)}
							<p className="break-all text-xs text-muted-foreground">
								{t("operation")}: {sample.operationId}
							</p>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
