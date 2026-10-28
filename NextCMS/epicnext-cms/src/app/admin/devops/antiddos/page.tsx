import { BadgeCheck, Cloud, Lock, Server, ShieldAlert } from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
	removeCloudflareRule,
	resetAntiddosSettings,
	saveAntiddosSettings,
	unbanAntiddosIp,
	verifyCloudflareConfiguration,
} from "@/actions/admin-antiddos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	antiddosDefaultsFromEnv,
	getAntiddosConfig,
} from "@/lib/antiddos-config";
import { resolveClientIp } from "@/lib/client-ip";
import { isCloudflareProxied, preferredClientIpHeader } from "@/lib/cloudflare";
import {
	type CloudflareBlockView,
	cloudflareEnabled,
	getLastCloudflareVerify,
	listCloudflareBlocks,
	sweepExpiredCloudflareBlocks,
} from "@/lib/cloudflare-api";
import { db, WebsiteSetting } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { redis } from "@/lib/redis";

function seconds(ttlMs: number): string {
	const s = Math.floor(ttlMs / 1000);
	if (s <= 0) return "–";
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ""}`;
	return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export default async function AdminAntiDdosPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SETTINGS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const [effective, defaults, requestHeaders, persistedRows] =
		await Promise.all([
			getAntiddosConfig(),
			antiddosDefaultsFromEnv(),
			headers(),
			db
				.select({ key: WebsiteSetting.key, value: WebsiteSetting.value })
				.from(WebsiteSetting)
				.then((rows) => new Map(rows.map((r) => [r.key, r.value])))
				.catch(() => new Map() as Map<string, string>),
		]);

	const cloudflare = isCloudflareProxied(requestHeaders);
	const sourceHeader = preferredClientIpHeader(requestHeaders);
	const viewerIp = resolveClientIp(requestHeaders);

	let blocks: {
		ip: string;
		ttlMs: number;
		count: number;
		source: "gate";
	}[] = [];
	let redisOk = false;
	const rateStore = redis;
	if (rateStore) {
		redisOk = true;
		try {
			const blockKeys = await rateStore.keys("antiddos:block:*");
			const violationKeys = await rateStore.keys("antiddos:v:*");
			const violationCounts = new Map<string, number>();
			for (const key of violationKeys.slice(0, 200)) {
				// incr is used on writes; for display we just read the raw value.
				const raw = await rateStore.get(key);
				const n = Number(raw);
				violationCounts.set(
					key.replace(`antiddos:v:`, ""),
					Number.isFinite(n) ? n : 0,
				);
			}
			const withTtl = await Promise.all(
				blockKeys.slice(0, 100).map(async (key) => {
					const ttlMs = await rateStore.pttl(key);
					const ip = key.replace("antiddos:block:", "");
					return {
						ip,
						ttlMs: Math.max(ttlMs, 0),
						count: violationCounts.get(ip) ?? 0,
						source: "gate" as const,
					};
				}),
			);
			blocks = withTtl
				.filter((b) => b.ttlMs > 0)
				.sort((a, b) => a.ttlMs - b.ttlMs);
		} catch {
			redisOk = false;
		}
	}

	const stored = persistedRows;

	const cloudflareConfigured = cloudflareEnabled();
	const cloudflareBlocks: CloudflareBlockView[] = [];
	if (cloudflareConfigured) {
		await sweepExpiredCloudflareBlocks();
		cloudflareBlocks.push(...(await listCloudflareBlocks()));
	}
	const lastVerify = await getLastCloudflareVerify();

	return (
		<div className="space-y-6">
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Gate</CardTitle>
						<ShieldAlert className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<Badge variant={effective.enabled ? "default" : "secondary"}>
							{effective.enabled ? "Enabled" : "Disabled"}
						</Badge>
						<p className="text-xs text-muted-foreground mt-1">
							Boot default: {defaults.enabled ? "on" : "off"}
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Rates</CardTitle>
						<Server className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{effective.api.limit}
							<span className="text-sm font-normal text-muted-foreground">
								{" "}
								/min API
							</span>
						</div>
						<p className="text-xs text-muted-foreground mt-1">
							Pages {effective.pages.limit} · Auth {effective.auth.limit} ·
							Global {effective.global.limit}
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Cloudflare</CardTitle>
						<Cloud className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<Badge variant={cloudflare ? "default" : "secondary"}>
							{cloudflare ? "Detected" : "Not detected"}
						</Badge>
						<p className="text-xs text-muted-foreground mt-1">
							IP source: {sourceHeader}
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Active blocks</CardTitle>
						<Lock className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div
							className="text-2xl font-bold"
							style={{
								color: blocks.length ? "var(--destructive)" : undefined,
							}}
						>
							{blocks.length}
						</div>
						<p className="text-xs text-muted-foreground mt-1">
							Temporary DDoS blocks
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Redis</CardTitle>
						<BadgeCheck className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<Badge variant={redisOk ? "default" : "destructive"}>
							{redisOk ? "Connected" : "Unavailable"}
						</Badge>
						<p className="text-xs text-muted-foreground mt-1">
							Shared rate-limit state
						</p>
					</CardContent>
				</Card>
			</div>

			{!cloudflare && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Cloud className="h-4 w-4" /> Cloudflare not detected
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-sm text-muted-foreground">
							This request did not arrive through Cloudflare. When the site DNS
							is proxied (orange cloud), the CMS trusts the real visitor IP from{" "}
							<span className="font-mono">CF-Connecting-IP</span>. A direct
							client can spoof that header — put the origin behind Cloudflare
							and restrict direct access to the origin ports for full DDoS
							protection.
						</p>
						<p className="text-sm text-muted-foreground mt-2">
							Your request is keyed as{" "}
							<span className="font-mono">{viewerIp}</span> (via{" "}
							<span className="font-mono">{sourceHeader}</span>).
						</p>
					</CardContent>
				</Card>
			)}

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<ShieldAlert className="h-4 w-4" /> Anti-DDoS settings
					</CardTitle>
				</CardHeader>
				<CardContent>
					<form action={saveAntiddosSettings} className="space-y-4">
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								name="enabled"
								value="1"
								defaultChecked={effective.enabled}
							/>
							Enable the app-layer anti-DDoS gate (production only)
						</label>

						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								name="cfa_auto_block"
								value="1"
								defaultChecked={effective.cloudflareAutoBlock}
							/>
							Automatically create Cloudflare edge blocks when an IP hits the
							block threshold
						</label>
						<p className="text-xs text-muted-foreground -mt-2">
							Requires <span className="font-mono">CLOUDFLARE_API_TOKEN</span>{" "}
							and <span className="font-mono">CLOUDFLARE_ZONE_ID</span> in the
							environment. Blocks are only created for traffic that provably
							transits Cloudflare, and expire together with the host-level
							block.
						</p>

						<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
							{(
								[
									["pages", "Pages", "pages_limit", "pages_window_sec"],
									["api", "API", "api_limit", "api_window_sec"],
									["auth", "Auth", "auth_limit", "auth_window_sec"],
								] as const
							).map(([category, label, limitName, windowName]) => (
								<div key={category} className="rounded-md border p-3">
									<p className="font-semibold text-sm mb-2">{label}</p>
									<div className="flex items-center gap-2">
										<input
											name={limitName}
											type="number"
											defaultValue={effective[category].limit}
											className="w-24"
										/>
										<span className="text-xs text-muted-foreground">
											req/min
										</span>
										<input
											name={windowName}
											type="number"
											defaultValue={effective[category].windowSeconds}
											className="w-20"
										/>
										<span className="text-xs text-muted-foreground">
											sec window
										</span>
									</div>
								</div>
							))}
						</div>

						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<label className="block">
								<span className="text-xs font-medium">
									Global valve (req/min)
								</span>
								<div className="flex items-center gap-2 mt-1">
									<input
										name="global_limit"
										type="number"
										defaultValue={effective.global.limit}
										className="w-24"
									/>
									<input
										name="global_window_sec"
										type="number"
										defaultValue={effective.global.windowSeconds}
										className="w-20"
									/>
									<span className="text-xs text-muted-foreground">
										sec window
									</span>
								</div>
							</label>
							<label className="block">
								<span className="text-xs font-medium">
									Global halt short-circuit (ms)
								</span>
								<input
									name="global_halt_ms"
									type="number"
									defaultValue={effective.globalHaltMs}
									className="w-32 mt-1"
								/>
							</label>
							<label className="block">
								<span className="text-xs font-medium">
									Violation window (sec)
								</span>
								<input
									name="violation_window_sec"
									type="number"
									defaultValue={effective.violationWindowSeconds}
									className="w-32 mt-1"
								/>
							</label>
							<label className="block">
								<span className="text-xs font-medium">
									Violations before block
								</span>
								<input
									name="max_violations"
									type="number"
									defaultValue={effective.maxViolations}
									className="w-32 mt-1"
								/>
							</label>
						</div>

						<div>
							<label className="block">
								<span className="text-xs font-medium">
									Escalation tiers (min:ttlSeconds, comma separated)
								</span>
								<input
									name="block_tiers"
									defaultValue={effective.blockTiers
										.map((t) => `${t.minViolations}:${t.ttlSeconds}`)
										.join(",")}
									className="w-full mt-1 font-mono"
								/>
							</label>
							<p className="text-xs text-muted-foreground mt-1">
								Boot default:{" "}
								{defaults.blockTiers
									.map((t) => `${t.minViolations}:${t.ttlSeconds}`)
									.join(", ")}
							</p>
						</div>

						<div className="flex gap-2">
							<Button type="submit" variant="default">
								Save settings
							</Button>
						</div>
					</form>

					<form action={resetAntiddosSettings} className="mt-4">
						<Button type="submit" variant="outline">
							Reset to boot defaults (env)
						</Button>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Lock className="h-4 w-4" /> Blocked IPs ({blocks.length})
					</CardTitle>
				</CardHeader>
				<CardContent>
					{blocks.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No IPs are currently rate-limited into a temporary block.
						</p>
					) : (
						<div className="space-y-2">
							{blocks.map((b) => {
								return (
									<div
										key={b.ip}
										className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
									>
										<span className="font-mono">{b.ip}</span>
										<span className="flex items-center gap-2 text-xs text-muted-foreground">
											<Badge variant="secondary">Gate</Badge>
											TTL {seconds(b.ttlMs)} · violations {b.count}
										</span>
										<form action={unbanAntiddosIp}>
											<input type="hidden" name="ip" value={b.ip} />
											<Button type="submit" size="sm" variant="outline">
												Unban
											</Button>
										</form>
									</div>
								);
							})}
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Cloud className="h-4 w-4" /> Cloudflare edge blocks
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex flex-wrap items-center gap-3">
						<Badge variant={cloudflareConfigured ? "default" : "secondary"}>
							{cloudflareConfigured ? "API configured" : "API not configured"}
						</Badge>
						{!cloudflareConfigured && (
							<p className="text-xs text-muted-foreground">
								Set <span className="font-mono">CLOUDFLARE_API_TOKEN</span> and{" "}
								<span className="font-mono">CLOUDFLARE_ZONE_ID</span> to enable
								automatic edge blocking via the Cloudflare API.
							</p>
						)}
						<form action={verifyCloudflareConfiguration}>
							<Button
								type="submit"
								size="sm"
								variant="outline"
								disabled={!cloudflareConfigured}
							>
								Verify connection
							</Button>
						</form>
					</div>

					{lastVerify && cloudflareConfigured && (
						<p className="text-xs">
							<Badge variant={lastVerify.ok ? "default" : "destructive"}>
								{lastVerify.ok ? "Reachable" : "Failed"}
							</Badge>
							<span className="ml-2 text-muted-foreground">
								{lastVerify.ok
									? `Zone ${lastVerify.zoneName ?? lastVerify.zoneId ?? ""} — verified ${new Date(lastVerify.at).toLocaleString()}`
									: lastVerify.message}
							</span>
						</p>
					)}

					{cloudflareConfigured && cloudflareBlocks.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No automatic Cloudflare blocks are active. When the gate blocks a
							repeat offender behind Cloudflare, an IP Access Rule is created
							here automatically.
						</p>
					) : (
						cloudflareConfigured && (
							<div className="space-y-2">
								{cloudflareBlocks.map((b) => (
									<div
										key={b.ip}
										className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
									>
										<span className="font-mono">{b.ip}</span>
										<span className="text-xs text-muted-foreground">
											{b.category} · {seconds(b.remainingSeconds * 1000)} left
										</span>
										<form action={removeCloudflareRule}>
											<input type="hidden" name="ip" value={b.ip} />
											<Button type="submit" size="sm" variant="outline">
												Remove rule
											</Button>
										</form>
									</div>
								))}
								<p className="text-xs text-muted-foreground">
									Expired rules are swept automatically every 30s.
								</p>
							</div>
						)
					)}
				</CardContent>
			</Card>

			{stored.size === 0 && (
				<p className="text-xs text-muted-foreground">
					Persisted site settings: none yet — the form values above reflect the
					current effective configuration.
				</p>
			)}
		</div>
	);
}
