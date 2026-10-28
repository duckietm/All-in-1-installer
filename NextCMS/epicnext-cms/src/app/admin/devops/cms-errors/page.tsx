import { redirect } from "next/navigation";

import { getTranslations } from "next-intl/server";

import Link from "@/components/link";

import { queryErrorGroups } from "@/lib/error-group-query";
import { summarizeErrorGroup } from "@/lib/error-groups";

import { ErrorStore } from "@/lib/error-monitor";

import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

import { assignCmsError, resolveCmsError } from "./actions";

export default async function CmsErrorsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const { session, permissions } = await getAdminContext();

	if (!canAccess(permissions, PERMS.DEVOPS_VIEW, session.user.rank))
		redirect("/admin");

	const t = await getTranslations("pages.admin.cmsErrors");

	const params = await searchParams;

	let result: Awaited<ReturnType<ErrorStore["read"]>>;

	try {
		result = await new ErrorStore().read();
	} catch {
		return (
			<div className="admin-card" role="alert">
				{t("storageError")}
			</div>
		);
	}

	const releases = [...new Set(result.records.map((r) => r.release))].sort();
	const queried = queryErrorGroups(result.records, params);
	const groups = new Map(
		queried.map((group) => [group.fingerprint, group.events]),
	);
	const latestByGroup = new Map(
		queried.map((group) => [group.fingerprint, group.latest]),
	);

	const filtered = [...groups.values()].flat();

	const page = Math.max(
		1,

		Math.min(
			Math.floor(Number(params.page)) || 1,

			Math.max(1, Math.ceil(groups.size / 25)),
		),
	);

	const pageHref = (next: number) =>
		`?${new URLSearchParams({ q: params.q ?? "", source: params.source ?? "", status: params.status ?? "", release: params.release ?? "", period: params.period ?? "", sort: params.sort ?? "", page: String(next) })}`;

	return (
		<div className="space-y-5">
			<div>
				<h1 className="text-2xl font-semibold">{t("title")}</h1>
				<p className="text-muted-foreground">{t("subtitle")}</p>
			</div>
			<div className="flex flex-wrap gap-3">
				<Link href="/admin/devops" className="btn btn-outline">
					DevOps
				</Link>
				<Link href="/admin/devops/errors" className="btn btn-outline">
					{t("emulator")}
				</Link>
				<Link href="/admin/devops/cms-errors" className="btn btn-outline">
					{t("refresh")}
				</Link>
			</div>
			<form className="admin-card flex flex-wrap gap-3">
				<input
					aria-label={t("search")}
					name="q"
					defaultValue={params.q}
					placeholder={t("searchHint")}
					className="input min-w-0 flex-1"
				/>
				<select
					name="source"
					aria-label={t("source")}
					defaultValue={params.source ?? ""}
					className="input"
				>
					<option value="">{t("allSources")}</option>
					<option value="server">Server</option>
					<option value="browser">Browser</option>
				</select>
				<select
					name="status"
					aria-label={t("status")}
					defaultValue={params.status ?? ""}
					className="input"
				>
					<option value="">{t("allStatuses")}</option>
					<option value="open">{t("open")}</option>
					<option value="resolved">{t("resolved")}</option>
				</select>
				<select
					name="release"
					aria-label={t("releaseFilter")}
					defaultValue={params.release ?? ""}
					className="input max-w-full"
				>
					<option value="">{t("allReleases")}</option>
					{releases.map((release) => (
						<option key={release} value={release}>
							{release}
						</option>
					))}
				</select>
				<select
					name="period"
					aria-label={t("period")}
					defaultValue={params.period ?? ""}
					className="input"
				>
					<option value="">{t("allRetained")}</option>
					<option value="24h">{t("last24h")}</option>
					<option value="7d">{t("last7d")}</option>
				</select>
				<select
					name="sort"
					aria-label={t("sort")}
					defaultValue={params.sort ?? ""}
					className="input"
				>
					<option value="">{t("recentFirst")}</option>
					<option value="frequency">{t("frequentFirst")}</option>
				</select>
				<button type="submit" className="btn btn-primary">
					{t("search")}
				</button>
			</form>
			<p className="text-sm text-muted-foreground">
				{t("counts", { count: filtered.length, groups: groups.size })}{" "}
				{result.truncated ? t("truncated") : ""} {t("retention")}{" "}
				{t("filterScope")}
			</p>
			{groups.size === 0 ? (
				<div className="admin-card">{t("empty")}</div>
			) : null}
			{[...groups.entries()]

				.slice((page - 1) * 25, page * 25)

				.map(([fingerprint, events]) => {
					const metrics = summarizeErrorGroup(events);

					const groupLatest = latestByGroup.get(fingerprint);
					if (!groupLatest || !metrics.latest) return null;
					// Details follow the selected occurrence; triage belongs to the whole group.
					const r = {
						...metrics.latest,
						resolved: groupLatest.resolved,
						assignment: groupLatest.assignment,
					};

					return (
						<details key={fingerprint} className="admin-card overflow-hidden">
							<summary className="cursor-pointer">
								<span className="text-xs text-muted-foreground">
									{t(r.resolved ? "resolved" : "open")} Â· {r.source} Â·{" "}
									{t("occurrences", { count: events.length })} Â· {r.at}
								</span>
								<p className="font-semibold break-words">{r.event}</p>
								<p className="text-sm break-words">{r.message}</p>
							</summary>
							<div className="mt-4 space-y-3 text-sm">
								<dl className="grid gap-2 sm:grid-cols-2">
									<div>
										<dt className="text-muted-foreground">{t("firstSeen")}</dt>
										<dd>
											<time dateTime={metrics.firstAt ?? ""}>
												{metrics.firstAt}
											</time>
										</dd>
									</div>
									<div>
										<dt className="text-muted-foreground">{t("lastSeen")}</dt>
										<dd>
											<time dateTime={metrics.lastAt ?? ""}>
												{metrics.lastAt}
											</time>
										</dd>
									</div>
									<div>
										<dt className="text-muted-foreground">
											{t("affectedUsers")}
										</dt>
										<dd>{metrics.affectedUsers}</dd>
									</div>
									<div>
										<dt className="text-muted-foreground">
											{t("unidentifiedEvents")}
										</dt>
										<dd>{metrics.unidentified}</dd>
									</div>
								</dl>
								<p className="text-xs text-muted-foreground">
									{t("metricsScope")}
								</p>
								<p>
									{r.assignment
										? t("assignedStaff", { id: r.assignment.userId })
										: t("unassigned")}
								</p>
								{canAccess(
									permissions,
									PERMS.DEVOPS_EDIT,
									session.user.rank,
								) && (
									<form
										action={assignCmsError}
										className="flex flex-wrap gap-2"
									>
										<input
											type="hidden"
											name="fingerprint"
											value={fingerprint}
										/>
										{r.assignment?.userId !== session.user.id && (
											<button
												type="submit"
												name="assignment"
												value="self"
												className="btn btn-outline"
											>
												{t("assignSelf")}
											</button>
										)}
										{r.assignment && (
											<button
												type="submit"
												name="assignment"
												value="clear"
												className="btn btn-outline"
											>
												{t("clearAssignment")}
											</button>
										)}
									</form>
								)}
								{metrics.auditLink && (
									<Link href={metrics.auditLink} className="btn btn-outline">
										{t("auditTrail")}
									</Link>
								)}
								{metrics.operationLink && (
									<Link
										href={metrics.operationLink}
										className="btn btn-outline"
									>
										{t("openOperation")}
									</Link>
								)}
								<details>
									<summary className="cursor-pointer">
										{t("releaseOccurrences")}
									</summary>
									<ul className="mt-2 space-y-2">
										{metrics.releases.map((release) => (
											<li key={release.release} className="break-all">
												<code>{release.release}</code> Â·{" "}
												{t("occurrences", { count: release.count })} Â·{" "}
												{release.firstAt} â€” {release.lastAt}
											</li>
										))}
									</ul>
									<p className="text-xs text-muted-foreground">
										{t("releaseScope")}
									</p>
								</details>
								<p>
									{t("reference")}: <code className="break-all">{r.id}</code>
								</p>
								<p>
									{t("release")}: <code className="break-all">{r.release}</code>
								</p>
								<pre className="whitespace-pre-wrap break-all rounded bg-muted p-3">
									{JSON.stringify(r.context, null, 2)}
								</pre>
								<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3">
									{r.stack || t("noStack")}
								</pre>
								{!r.resolved &&
								canAccess(permissions, PERMS.DEVOPS_EDIT, session.user.rank) ? (
									<form action={resolveCmsError}>
										<input
											type="hidden"
											name="fingerprint"
											value={r.fingerprint}
										/>
										<button type="submit" className="btn btn-outline">
											{t("resolve")}
										</button>
										<p className="text-muted-foreground text-xs">
											{t("reopenHint")}
										</p>
									</form>
								) : null}
								<details>
									<summary className="cursor-pointer">
										{t("references")}
									</summary>
									<ul>
										{events.map((e) => (
											<li key={e.id} className="break-all">
												{e.at} Â· {e.id}
											</li>
										))}
									</ul>
								</details>
								<p className="text-muted-foreground">{t("stackHint")}</p>
							</div>
						</details>
					);
				})}
			<nav aria-label={t("pages")} className="flex gap-3">
				{page > 1 ? (
					<Link href={pageHref(page - 1)} className="btn btn-outline">
						{t("previous")}
					</Link>
				) : null}
				{page * 25 < groups.size ? (
					<Link href={pageHref(page + 1)} className="btn btn-outline">
						{t("next")}
					</Link>
				) : null}
			</nav>
		</div>
	);
}
