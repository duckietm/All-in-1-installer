import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
	addBlacklist,
	addWhitelist,
	deleteBlacklist,
	deleteWhitelist,
} from "@/actions/admin-ip";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { db, WebsiteIpBlacklist, WebsiteIpWhitelist } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

type IpRow = {
	id: bigint;
	ipAddress: string;
	asn: string | null;
	createdAt: Date | null;
};

export default async function AdminIp() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SETTINGS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.ip");
	let whitelist: IpRow[] = [];
	let blacklist: IpRow[] = [];

	try {
		whitelist = await db
			.select()
			.from(WebsiteIpWhitelist)
			.orderBy(desc(WebsiteIpWhitelist.id))
			.limit(200);
	} catch {
		whitelist = [];
	}

	try {
		blacklist = await db
			.select()
			.from(WebsiteIpBlacklist)
			.orderBy(desc(WebsiteIpBlacklist.id))
			.limit(200);
	} catch {
		blacklist = [];
	}

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard
					label={t("whitelisted")}
					value={whitelist.length}
					state={whitelist.length > 0 ? "ok" : "neutral"}
					icon="✅"
				/>
				<StatusCard
					label={t("blacklisted")}
					value={blacklist.length}
					state={blacklist.length > 0 ? "danger" : "neutral"}
					icon="🚫"
				/>
			</div>

			<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
				{/* ── Whitelist ──────────────────── */}
				<section className="mt-6">
					<h2 className="admin-section-title">{t("whitelist")}</h2>

					<form action={addWhitelist} className="admin-card mb-4">
						<div className="flex gap-2 flex-wrap">
							<input
								name="ipAddress"
								placeholder={t("ipAddressPlaceholder")}
								required
								className="flex-1 min-w-[140px]"
							/>
							<input
								name="asn"
								placeholder={t("asnPlaceholder")}
								className="w-[140px]"
							/>
							<Button type="submit" variant="secondary">
								{t("add")}
							</Button>
						</div>
					</form>

					{whitelist.length === 0 ? (
						<div className="admin-empty">{t("noWhitelistedIps")}</div>
					) : (
						<div className="overflow-x-auto">
							<table>
								<thead>
									<tr>
										<th>{t("colIp")}</th>
										<th>{t("colAsn")}</th>
										<th>{t("colAdded")}</th>
										<th />
									</tr>
								</thead>
								<tbody>
									{whitelist.map((w) => (
										<tr key={String(w.id)}>
											<td>{w.ipAddress}</td>
											<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
												{w.asn ?? "—"}
											</td>
											<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
												{formatDate(w.createdAt, "datetime", "—")}
											</td>
											<td>
												<form action={deleteWhitelist}>
													<input type="hidden" name="id" value={String(w.id)} />
													<Button type="submit" variant="destructive">
														{t("remove")}
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

				{/* ── Blacklist ──────────────────── */}
				<section className="mt-6">
					<h2 className="admin-section-title">{t("blacklist")}</h2>

					<form action={addBlacklist} className="admin-card mb-4">
						<div className="flex gap-2 flex-wrap">
							<input
								name="ipAddress"
								placeholder={t("ipAddressPlaceholder")}
								required
								className="flex-1 min-w-[140px]"
							/>
							<input
								name="asn"
								placeholder={t("asnPlaceholder")}
								className="w-[140px]"
							/>
							<Button type="submit" variant="destructive">
								{t("add")}
							</Button>
						</div>
					</form>

					{blacklist.length === 0 ? (
						<div className="admin-empty">{t("noBlacklistedIps")}</div>
					) : (
						<div className="overflow-x-auto">
							<table>
								<thead>
									<tr>
										<th>{t("colIp")}</th>
										<th>{t("colAsn")}</th>
										<th>{t("colAdded")}</th>
										<th />
									</tr>
								</thead>
								<tbody>
									{blacklist.map((b) => (
										<tr key={String(b.id)}>
											<td>{b.ipAddress}</td>
											<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
												{b.asn ?? "—"}
											</td>
											<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
												{formatDate(b.createdAt, "datetime", "—")}
											</td>
											<td>
												<form action={deleteBlacklist}>
													<input type="hidden" name="id" value={String(b.id)} />
													<Button type="submit" variant="destructive">
														{t("remove")}
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
			</div>
		</main>
	);
}
