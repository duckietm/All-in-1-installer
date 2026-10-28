"use client";

import {
	ArrowLeft,
	ChevronDown,
	Crown,
	Loader2,
	Save,
	Settings,
	Shield,
	ShieldCheck,
	Terminal,
	UserCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	saveRank as saveRankAction,
	setCmsPermissions,
} from "@/actions/permissions";
import { SearchInput } from "@/components/admin/search-input";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useServerAction } from "@/hooks/use-server-action";
import { avatarImageOnError, getAvatarUrl } from "@/lib/imager";
import { cn } from "@/lib/utils";
import { categorizePerms, PermToggle } from "./permission-controls";
import type { RankEditorProps } from "./rank-editor-types";
/* ─── Types ──────────────────────────────────────────────── */

/* ─── Main Component ─────────────────────────────────────── */

export function RankEditClient({
	rank: initialRank,
	users,
	totalUsers,
	cmsRole: initialCmsRole,
	allCmsPermissions,
}: RankEditorProps) {
	const { run, isPending } = useServerAction();
	const t = useTranslations("pages.admin.permissions.id.rankEditClient");

	const [general, setGeneral] = useState({
		rank_name: initialRank.rank_name,
		badge: initialRank.badge,
		prefix: initialRank.prefix,
		prefix_color: initialRank.prefix_color,
		hidden_rank: initialRank.hidden_rank,
		log_commands: initialRank.log_commands,
		room_effect: initialRank.room_effect,
		auto_credits_amount: initialRank.auto_credits_amount,
		auto_pixels_amount: initialRank.auto_pixels_amount,
		auto_gotw_amount: initialRank.auto_gotw_amount,
		auto_points_amount: initialRank.auto_points_amount,
	});

	const [perms, setPerms] = useState<Record<string, string>>(
		initialRank.permissions,
	);
	const [cmsPermSlugs, setCmsPermSlugs] = useState<string[]>(
		initialCmsRole?.permissionSlugs ?? [],
	);
	const [permSearch, setPermSearch] = useState("");
	const [cmsSearch, setCmsSearch] = useState("");
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

	const cats = useMemo(
		() => categorizePerms(Object.keys(initialRank.permissions)),
		[initialRank.permissions],
	);
	const enabledCount = Object.values(perms).filter((v) => v !== "0").length;
	const totalCount = Object.keys(perms).length;

	function setNum(field: string, val: string) {
		setGeneral((p) => ({ ...p, [field]: parseInt(val, 10) || 0 }));
	}

	function saveRank() {
		const fields = Object.fromEntries(
			Object.entries({ ...general, ...perms }).map(([key, value]) => [
				key,
				String(value),
			]),
		);
		run(() => saveRankAction({ id: initialRank.id, fields }), {
			successMessage: t("rankSaved"),
		});
	}

	async function toggleCms(slug: string) {
		if (!initialCmsRole) return;
		const prev = cmsPermSlugs;
		const next = prev.includes(slug)
			? prev.filter((s) => s !== slug)
			: [...prev, slug];
		setCmsPermSlugs(next);
		try {
			const r = await setCmsPermissions({
				roleId: initialCmsRole.id,
				permissionSlugs: next,
			});
			if (!r.ok) {
				setCmsPermSlugs(prev);
				toast.error(t("failed"));
			}
		} catch {
			setCmsPermSlugs(prev);
			toast.error(t("failed"));
		}
	}

	function toggle(key: string) {
		setCollapsed((p) => {
			const n = new Set(p);
			if (n.has(key)) n.delete(key);
			else n.add(key);
			return n;
		});
	}

	/* ── Collapsible perm section ──────────────────────────── */

	function setSectionAll(keys: string[], value: string) {
		setPerms((p) => {
			const next = { ...p };
			for (const k of keys) next[k] = value;
			return next;
		});
	}

	function setAllPerms(value: string) {
		setPerms((p) => {
			const next = { ...p };
			for (const k of Object.keys(next)) next[k] = value;
			return next;
		});
	}

	function PermSection({
		title,
		keys,
		sectionKey,
	}: {
		title: string;
		keys: string[];
		sectionKey: string;
	}) {
		const filtered = permSearch
			? keys.filter((k) => k.toLowerCase().includes(permSearch.toLowerCase()))
			: keys;
		if (permSearch && filtered.length === 0) return null;
		const on = filtered.filter((k) => (perms[k] ?? "0") !== "0").length;
		const _allOn = on === filtered.length;
		void _allOn;
		const open = !collapsed.has(sectionKey);

		return (
			<div className="border rounded-lg overflow-hidden">
				<div className="flex items-center bg-muted/30">
					<button
						type="button"
						onClick={() => toggle(sectionKey)}
						className="flex flex-1 items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
					>
						<span className="text-sm font-medium">{title}</span>
						<div className="flex items-center gap-2">
							<Badge
								variant={on > 0 ? "default" : "secondary"}
								className="text-[10px]"
							>
								{on}/{filtered.length}
							</Badge>
							<ChevronDown
								className={cn(
									"h-4 w-4 text-muted-foreground transition-transform",
									!open && "-rotate-90",
								)}
							/>
						</div>
					</button>
					{open && (
						<div className="flex gap-1 pr-3 shrink-0">
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-[10px]"
								onClick={(e) => {
									e.stopPropagation();
									setSectionAll(filtered, "1");
								}}
							>
								{t("allOn")}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-[10px]"
								onClick={(e) => {
									e.stopPropagation();
									setSectionAll(filtered, "0");
								}}
							>
								{t("allOff")}
							</Button>
						</div>
					)}
				</div>
				{open && (
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border">
						{filtered.map((key) => (
							<div
								key={key}
								className={cn(
									"flex items-center justify-between px-3 py-2 bg-card",
									(perms[key] ?? "0") !== "0" &&
										"bg-[var(--admin-success-subtle)]",
								)}
							>
								<span className="font-mono text-xs truncate mr-3">{key}</span>
								<PermToggle
									value={perms[key] ?? "0"}
									maxValue={initialRank.permissionMaxValues[key] ?? 1}
									onChange={(v) => setPerms((p) => ({ ...p, [key]: v }))}
								/>
							</div>
						))}
					</div>
				)}
			</div>
		);
	}

	const filteredCms = cmsSearch
		? allCmsPermissions.filter(
				(p) =>
					p.slug.toLowerCase().includes(cmsSearch.toLowerCase()) ||
					p.title?.toLowerCase().includes(cmsSearch.toLowerCase()),
			)
		: allCmsPermissions;

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center gap-3">
				<Link href="/admin/permissions">
					<Button variant="ghost" size="icon" className="h-8 w-8">
						<ArrowLeft className="h-4 w-4" />
					</Button>
				</Link>
				{initialRank.id >= 7 ? (
					<Crown className="h-6 w-6 text-[var(--admin-warning)]" />
				) : initialRank.id >= 5 ? (
					<ShieldCheck className="h-6 w-6 text-[var(--admin-info)]" />
				) : (
					<Shield className="h-6 w-6 text-muted-foreground" />
				)}
				<div>
					<h1 className="text-2xl font-bold">
						{general.rank_name || t("rankFallback", { id: initialRank.id })}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t("rankMeta", {
							id: initialRank.id,
							level: initialRank.level,
							count: totalUsers,
						})}
					</p>
				</div>
			</div>

			{/* Tabs */}
			<Tabs defaultValue="general">
				<TabsList>
					<TabsTrigger value="general">
						<Settings className="w-3.5 h-3.5 mr-1" /> {t("tabGeneral")}
					</TabsTrigger>
					<TabsTrigger value="emulator">
						<Terminal className="w-3.5 h-3.5 mr-1" />{" "}
						{t("tabEmulator", { count: enabledCount })}
					</TabsTrigger>
					<TabsTrigger value="cms">
						<UserCheck className="w-3.5 h-3.5 mr-1" />{" "}
						{t("tabCms", { count: cmsPermSlugs.length })}
					</TabsTrigger>
					<TabsTrigger value="users">
						{t("tabUsers", { count: totalUsers })}
					</TabsTrigger>
				</TabsList>

				{/* ═══ General ═══ */}
				<TabsContent value="general" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle className="text-base">{t("rankSettings")}</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
								<div className="space-y-1.5">
									<Label className="text-xs">{t("rankName")}</Label>
									<Input
										value={general.rank_name}
										onChange={(e) =>
											setGeneral({ ...general, rank_name: e.target.value })
										}
									/>
								</div>
								<div className="space-y-1.5">
									<Label className="text-xs">{t("badge")}</Label>
									<Input
										value={general.badge}
										onChange={(e) =>
											setGeneral({ ...general, badge: e.target.value })
										}
									/>
								</div>
								<div className="space-y-1.5">
									<Label className="text-xs">{t("prefix")}</Label>
									<Input
										value={general.prefix}
										onChange={(e) =>
											setGeneral({ ...general, prefix: e.target.value })
										}
									/>
								</div>
								<div className="space-y-1.5">
									<Label className="text-xs">{t("prefixColor")}</Label>
									<div className="flex gap-2">
										<Input
											value={general.prefix_color}
											onChange={(e) =>
												setGeneral({ ...general, prefix_color: e.target.value })
											}
										/>
										{general.prefix_color && (
											<div
												className="w-9 h-9 rounded border shrink-0"
												style={{
													backgroundColor: general.prefix_color.startsWith("#")
														? general.prefix_color
														: `#${general.prefix_color}`,
												}}
											/>
										)}
									</div>
								</div>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
								<div className="flex items-center justify-between rounded-lg border p-3">
									<div>
										<Label htmlFor="rank-hidden_rank" className="text-sm">
											{t("hiddenRank")}
										</Label>
										<p className="text-xs text-muted-foreground">
											{t("hideFromPublic")}
										</p>
									</div>
									<Switch
										id="rank-hidden_rank"
										checked={general.hidden_rank === "1"}
										onCheckedChange={(v) =>
											setGeneral({ ...general, hidden_rank: v ? "1" : "0" })
										}
									/>
								</div>
								<div className="flex items-center justify-between rounded-lg border p-3">
									<div>
										<Label htmlFor="rank-log_commands" className="text-sm">
											{t("logCommands")}
										</Label>
										<p className="text-xs text-muted-foreground">
											{t("recordToAuditLog")}
										</p>
									</div>
									<Switch
										id="rank-log_commands"
										checked={general.log_commands === "1"}
										onCheckedChange={(v) =>
											setGeneral({ ...general, log_commands: v ? "1" : "0" })
										}
									/>
								</div>
								<div className="space-y-1.5 rounded-lg border p-3">
									<Label className="text-xs">{t("roomEffectId")}</Label>
									<Input
										type="number"
										value={general.room_effect}
										onChange={(e) => setNum("room_effect", e.target.value)}
									/>
								</div>
							</div>
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
								<div className="space-y-1.5">
									<Label className="text-xs">{t("autoCredits")}</Label>
									<Input
										type="number"
										value={general.auto_credits_amount}
										onChange={(e) =>
											setNum("auto_credits_amount", e.target.value)
										}
									/>
								</div>
								<div className="space-y-1.5">
									<Label className="text-xs">{t("autoPixels")}</Label>
									<Input
										type="number"
										value={general.auto_pixels_amount}
										onChange={(e) =>
											setNum("auto_pixels_amount", e.target.value)
										}
									/>
								</div>
								<div className="space-y-1.5">
									<Label className="text-xs">{t("autoGotw")}</Label>
									<Input
										type="number"
										value={general.auto_gotw_amount}
										onChange={(e) => setNum("auto_gotw_amount", e.target.value)}
									/>
								</div>
								<div className="space-y-1.5">
									<Label className="text-xs">{t("autoPoints")}</Label>
									<Input
										type="number"
										value={general.auto_points_amount}
										onChange={(e) =>
											setNum("auto_points_amount", e.target.value)
										}
									/>
								</div>
							</div>
							<div className="flex justify-end mt-4">
								<Button onClick={saveRank} disabled={isPending} size="sm">
									{isPending ? (
										<Loader2 className="w-4 h-4 mr-1 animate-spin" />
									) : (
										<Save className="w-4 h-4 mr-1" />
									)}
									{t("save")}
								</Button>
							</div>
						</CardContent>
					</Card>

					{/* Users preview */}
					<Card>
						<CardHeader>
							<CardTitle className="text-base">
								{t("usersWithThisRank")}
								{totalUsers > users.length && (
									<span className="text-muted-foreground font-normal ml-1 text-sm">
										{t("showingUsers", {
											shown: users.length,
											total: totalUsers,
										})}
									</span>
								)}
							</CardTitle>
						</CardHeader>
						<CardContent>
							{users.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									{t("noUsersWithThisRank")}
								</p>
							) : (
								<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
									{users.map((u) => (
										<Link
											key={u.id}
											href={`/admin/users/show/${u.id}`}
											className="flex items-center gap-2 rounded-lg border p-2 hover:bg-muted/50 transition-colors"
										>
											<img
												src={getAvatarUrl(u.look, {
													size: "s",
													headDirection: 2,
												})}
												alt=""
												onError={avatarImageOnError}
												className="w-8 h-12 object-cover"
											/>
											<span className="text-xs font-medium truncate">
												{u.username}
											</span>
										</Link>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				{/* ═══ Emulator Permissions ═══ */}
				<TabsContent value="emulator" className="space-y-4">
					<div className="flex items-center justify-between flex-wrap gap-2">
						<p className="text-sm text-muted-foreground">
							{t("permissionsEnabled", {
								enabled: enabledCount,
								total: totalCount,
							})}
						</p>
						<div className="flex items-center gap-3">
							<div className="flex gap-1">
								<Button
									variant="outline"
									size="sm"
									className="h-7 text-xs"
									onClick={() => setAllPerms("1")}
								>
									{t("enableAll")}
								</Button>
								<Button
									variant="outline"
									size="sm"
									className="h-7 text-xs"
									onClick={() => setAllPerms("0")}
								>
									{t("disableAll")}
								</Button>
							</div>
							<div className="flex gap-2 text-[11px] text-muted-foreground">
								<span className="flex items-center gap-1">
									<span className="w-3 h-3 rounded bg-[var(--admin-text-muted)] inline-block" />{" "}
									{t("off")}
								</span>
								<span className="flex items-center gap-1">
									<span className="w-3 h-3 rounded bg-[var(--admin-success-subtle)] inline-block" />{" "}
									{t("on")}
								</span>
								<span className="flex items-center gap-1">
									<span className="w-3 h-3 rounded bg-[var(--admin-warning-subtle)] inline-block" />{" "}
									{t("owner")}
								</span>
							</div>
						</div>
					</div>

					<SearchInput
						placeholder={t("searchPermissionsPlaceholder")}
						value={permSearch}
						onChange={setPermSearch}
					/>

					<PermSection
						title={t("commands")}
						keys={cats.commands}
						sectionKey="cmd"
					/>
					<PermSection
						title={t("account")}
						keys={cats.account}
						sectionKey="acc"
					/>
					{cats.other.length > 0 && (
						<PermSection
							title={t("other")}
							keys={cats.other}
							sectionKey="other"
						/>
					)}

					<div className="flex justify-end">
						<Button onClick={saveRank} disabled={isPending}>
							{isPending ? (
								<Loader2 className="w-4 h-4 mr-1 animate-spin" />
							) : (
								<Save className="w-4 h-4 mr-1" />
							)}
							{t("saveRank")}
						</Button>
					</div>
				</TabsContent>

				{/* ═══ CMS Permissions ═══ */}
				<TabsContent value="cms" className="space-y-4">
					{initialRank.id < 4 ? (
						<div className="rounded-lg border bg-card p-6 text-center">
							<p className="text-muted-foreground">
								CMS permissions are available from rank 4 and above.
							</p>
						</div>
					) : (
						<>
							<div className="flex items-center justify-between">
								<p className="text-sm text-muted-foreground">
									{cmsPermSlugs.length} of {allCmsPermissions.length} assigned
								</p>
								<div className="flex gap-1">
									<Button
										variant="outline"
										size="sm"
										className="h-7 text-xs"
										onClick={async () => {
											if (!initialCmsRole) return;
											const all = allCmsPermissions.map((p) => p.slug);
											setCmsPermSlugs(all);
											const r = await setCmsPermissions({
												roleId: initialCmsRole.id,
												permissionSlugs: all,
											});
											if (!r.ok) {
												setCmsPermSlugs(initialCmsRole.permissionSlugs);
												toast.error("Failed");
											}
										}}
									>
										Select All
									</Button>
									<Button
										variant="outline"
										size="sm"
										className="h-7 text-xs"
										onClick={async () => {
											if (!initialCmsRole) return;
											setCmsPermSlugs([]);
											const r = await setCmsPermissions({
												roleId: initialCmsRole.id,
												permissionSlugs: [],
											});
											if (!r.ok) {
												setCmsPermSlugs(initialCmsRole.permissionSlugs);
												toast.error("Failed");
											}
										}}
									>
										Deselect All
									</Button>
								</div>
							</div>

							<SearchInput
								placeholder="Search CMS permissions..."
								value={cmsSearch}
								onChange={setCmsSearch}
							/>

							<div className="space-y-1">
								{filteredCms.map((perm) => {
									const on = cmsPermSlugs.includes(perm.slug);
									return (
										<div
											key={perm.id}
											className={cn(
												"flex items-center gap-3 rounded-lg border px-4 py-3 transition-all",
												on
													? "border-[var(--admin-success-border)] bg-[var(--admin-success-subtle)]"
													: "hover:bg-muted/50",
											)}
										>
											<Checkbox
												checked={on}
												onCheckedChange={() => toggleCms(perm.slug)}
											/>
											<div className="flex-1 min-w-0">
												<span className="text-sm font-mono">{perm.slug}</span>
												{perm.title && (
													<span className="text-xs text-muted-foreground ml-2">
														{perm.title}
													</span>
												)}
											</div>
											{on && (
												<Badge className="bg-[var(--admin-success-subtle)] text-[var(--admin-success)] border-[var(--admin-success-border)] text-[10px]">
													Active
												</Badge>
											)}
										</div>
									);
								})}
							</div>
							{filteredCms.length === 0 && (
								<p className="text-sm text-muted-foreground text-center py-4">
									No permissions match your search.
								</p>
							)}
						</>
					)}
				</TabsContent>

				{/* ═══ Users ═══ */}
				<TabsContent value="users">
					<Card>
						<CardHeader>
							<CardTitle className="text-base">
								{t("usersWithThisRank")}
								{totalUsers > users.length && (
									<span className="text-muted-foreground font-normal ml-1 text-sm">
										{t("showingUsers", {
											shown: users.length,
											total: totalUsers,
										})}
									</span>
								)}
							</CardTitle>
						</CardHeader>
						<CardContent>
							{users.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									{t("noUsersWithThisRank")}
								</p>
							) : (
								<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
									{users.map((u) => (
										<Link
											key={u.id}
											href={`/admin/users/show/${u.id}`}
											className="flex items-center gap-2 rounded-lg border p-2 hover:bg-muted/50 transition-colors"
										>
											<img
												src={getAvatarUrl(u.look, {
													size: "s",
													headDirection: 2,
												})}
												alt=""
												onError={avatarImageOnError}
												className="w-8 h-12 object-cover"
											/>
											<span className="text-xs font-medium truncate">
												{u.username}
											</span>
										</Link>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	);
}
