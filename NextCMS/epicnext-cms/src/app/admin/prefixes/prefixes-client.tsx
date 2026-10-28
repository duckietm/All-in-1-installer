"use client";

import { Pencil, Plus, Save, Search, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import {
	addBlacklistWord as addBlacklistWordAction,
	createPrefix,
	deletePrefix as deletePrefixAction,
	removeBlacklistWord as removeBlacklistWordAction,
	updatePrefix,
	updatePrefixSettings,
} from "@/actions/prefixes";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useServerAction } from "@/hooks/use-server-action";
import { formatDate } from "@/lib/format-date";

import { PrefixDialog } from "./prefix-dialog";
import {
	type BlacklistWord,
	PRESET_EFFECTS,
	type PrefixFormData,
	type PrefixSettings,
	type UserPrefix,
} from "./prefix-model";
export function PrefixesClient({ canEdit }: { canEdit: boolean }) {
	const t = useTranslations("pages.admin.prefixes.prefixesClient");
	const { run, isPending } = useServerAction();
	const { confirm, dialog: confirmDialog } = useConfirmDialog();
	const [prefixes, setPrefixes] = useState<UserPrefix[]>([]);
	const [searchQuery, setSearchQuery] = useState("");
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);

	const [blacklist, setBlacklist] = useState<BlacklistWord[]>([]);
	const [newWord, setNewWord] = useState("");

	const [settings, setSettings] = useState<PrefixSettings>({
		max_length: "15",
		min_rank_to_buy: "1",
		price_credits: "5",
		price_points: "0",
		points_type: "0",
	});

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editPrefix, setEditPrefix] = useState<UserPrefix | null>(null);

	const fetchPrefixes = useCallback(async () => {
		const params = new URLSearchParams({ page: String(page) });
		if (searchQuery) params.set("q", searchQuery);
		const res = await fetch(`/cms_api/admin/prefixes?${params}`);
		if (!res.ok) return;
		const data = await res.json();
		if (data.ok) {
			setPrefixes(data.prefixes);
			setTotalPages(data.pages);
		}
	}, [page, searchQuery]);

	const fetchBlacklist = useCallback(async () => {
		const res = await fetch("/cms_api/admin/prefixes/blacklist");
		if (!res.ok) return;
		const data = await res.json();
		if (data.ok) setBlacklist(data.words);
	}, []);

	const fetchSettings = useCallback(async () => {
		const res = await fetch("/cms_api/admin/prefixes/settings");
		if (!res.ok) return;
		const data = await res.json();
		if (data.ok) setSettings(data.settings);
	}, []);

	useEffect(() => {
		fetchPrefixes();
	}, [fetchPrefixes]);

	useEffect(() => {
		fetchBlacklist();
		fetchSettings();
	}, [fetchBlacklist, fetchSettings]);

	const handleDeletePrefix = async (id: number) => {
		const ok = await confirm({
			title: t("confirmDeleteTitle"),
			description: t("confirmDeleteDesc"),
			confirmLabel: t("confirmDelete"),
			cancelLabel: t("cancel"),
		});
		if (!ok) return;
		run(() => deletePrefixAction({ id }), {
			successMessage: t("successPrefixDeleted"),
			onSuccess: () => {
				fetchPrefixes();
			},
		});
	};

	const handleSavePrefix = (
		data: PrefixFormData,
		editId?: number,
	): Promise<boolean> => {
		if (isPending) return Promise.resolve(false);
		return new Promise((resolve) => {
			const fields = {
				text: data.text,
				color: data.color,
				icon: data.icon,
				effect: data.effect,
				active: data.active ? 1 : 0,
			};
			run(
				() =>
					editId
						? updatePrefix({ id: editId, ...fields })
						: createPrefix({ username: data.username, ...fields }),
				{
					successMessage: editId
						? t("successPrefixUpdated")
						: t("successPrefixCreated"),
					onSuccess: () => {
						void fetchPrefixes();
						resolve(true);
					},
					onError: () => resolve(false),
				},
			);
		});
	};

	const openAddDialog = () => {
		setEditPrefix(null);
		setDialogOpen(true);
	};

	const openEditDialog = (prefix: UserPrefix) => {
		setEditPrefix(prefix);
		setDialogOpen(true);
	};

	const handleAddBlacklistWord = async () => {
		if (!newWord.trim()) return;
		run(() => addBlacklistWordAction({ word: newWord.trim() }), {
			successMessage: t("successWordAdded"),
			onSuccess: () => {
				setNewWord("");
				fetchBlacklist();
			},
		});
	};

	const handleRemoveBlacklistWord = async (id: number) => {
		run(() => removeBlacklistWordAction({ id }), {
			successMessage: t("successWordRemoved"),
			onSuccess: () => {
				fetchBlacklist();
			},
		});
	};

	const saveSettings = async () => {
		run(
			() =>
				updatePrefixSettings({
					settings: settings as unknown as Record<string, string>,
				}),
			{
				successMessage: t("successSettingsSaved"),
			},
		);
	};

	return (
		<>
			{confirmDialog}
			<PrefixDialog
				editPrefix={editPrefix}
				isOpen={dialogOpen}
				onClose={() => setDialogOpen(false)}
				onSave={handleSavePrefix}
			/>

			<Tabs defaultValue="prefixes">
				<TabsList>
					<TabsTrigger value="prefixes">{t("tabUserPrefixes")}</TabsTrigger>
					<TabsTrigger value="blacklist">{t("tabBlacklist")}</TabsTrigger>
					<TabsTrigger value="settings">{t("tabSettings")}</TabsTrigger>
				</TabsList>

				<TabsContent value="prefixes" className="space-y-4">
					<div className="flex items-center gap-2">
						<div className="relative flex-1 max-w-sm">
							<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
							<Input
								className="pl-8"
								placeholder="Search by user or text..."
								value={searchQuery}
								onChange={(e) => {
									setSearchQuery(e.target.value);
									setPage(1);
								}}
							/>
						</div>
						<Button variant="outline" onClick={fetchPrefixes}>
							Search
						</Button>
						{canEdit && (
							<Button onClick={openAddDialog}>
								<Plus className="h-4 w-4 mr-1" />
								Add
							</Button>
						)}
					</div>

					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>ID</TableHead>
								<TableHead>User</TableHead>
								<TableHead>Prefix</TableHead>
								<TableHead>Color</TableHead>
								<TableHead>Icon</TableHead>
								<TableHead>Effect</TableHead>
								<TableHead>Active</TableHead>
								<TableHead>Date</TableHead>
								{canEdit && <TableHead>Actions</TableHead>}
							</TableRow>
						</TableHeader>
						<TableBody>
							{prefixes.map((prefix) => {
								const colors = prefix.color.split(",");
								const hasMultiColor =
									colors.length > 1 && new Set(colors).size > 1;
								const prefixIcon = prefix.icon || "";

								return (
									<TableRow key={prefix.id}>
										<TableCell>{prefix.id}</TableCell>
										<TableCell>
											{prefix.username || `#${prefix.user_id}`}
										</TableCell>
										<TableCell>
											<span style={{ fontWeight: "bold" }}>
												{hasMultiColor ? (
													<>
														{"{"}
														{[...prefix.text].map((char, i) => (
															<span
																key={char}
																style={{
																	color: colors[Math.min(i, colors.length - 1)],
																}}
															>
																{char}
															</span>
														))}
														{"}"}
													</>
												) : (
													<span style={{ color: colors[0] || "#FFFFFF" }}>
														{"{"}
														{prefix.text}
														{"}"}
													</span>
												)}
											</span>
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-1">
												{colors.slice(0, 5).map((c) => (
													<div
														key={c}
														className="w-4 h-4 rounded border"
														style={{ backgroundColor: c }}
														title={c}
													/>
												))}
												{colors.length > 5 && (
													<span className="text-xs text-muted-foreground">
														+{colors.length - 5}
													</span>
												)}
											</div>
										</TableCell>
										<TableCell className="text-center text-lg">
											{prefixIcon || "-"}
										</TableCell>
										<TableCell className="text-xs">
											{prefix.effect
												? PRESET_EFFECTS.find((fx) => fx.id === prefix.effect)
														?.label || prefix.effect
												: "-"}
										</TableCell>
										<TableCell>{prefix.active ? "Yes" : "No"}</TableCell>
										<TableCell className="text-xs">
											{prefix.created_at
												? formatDate(new Date(prefix.created_at), "date")
												: "—"}
										</TableCell>
										{canEdit && (
											<TableCell>
												<div className="flex items-center gap-1">
													<Button
														size="icon"
														variant="outline"
														onClick={() => openEditDialog(prefix)}
													>
														<Pencil className="h-4 w-4" />
													</Button>
													<Button
														size="icon"
														variant="destructive"
														disabled={isPending}
														onClick={() => handleDeletePrefix(prefix.id)}
													>
														<Trash2 className="h-4 w-4" />
													</Button>
												</div>
											</TableCell>
										)}
									</TableRow>
								);
							})}
							{prefixes.length === 0 && (
								<TableRow>
									<TableCell
										className="text-center text-muted-foreground"
										colSpan={9}
									>
										No prefixes found
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>

					{totalPages > 1 && (
						<div className="flex items-center justify-center gap-2">
							<Button
								disabled={page <= 1}
								size="sm"
								variant="outline"
								onClick={() => setPage(page - 1)}
							>
								Previous
							</Button>
							<span className="text-sm">
								Page {page} of {totalPages}
							</span>
							<Button
								disabled={page >= totalPages}
								size="sm"
								variant="outline"
								onClick={() => setPage(page + 1)}
							>
								Next
							</Button>
						</div>
					)}
				</TabsContent>

				<TabsContent value="blacklist" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Forbidden Words</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							{canEdit && (
								<div className="flex items-center gap-2">
									<Input
										placeholder="Add word..."
										value={newWord}
										onChange={(e) => setNewWord(e.target.value)}
										onKeyDown={(e) =>
											e.key === "Enter" && handleAddBlacklistWord()
										}
									/>
									<Button disabled={isPending} onClick={handleAddBlacklistWord}>
										<Plus className="h-4 w-4 mr-1" />
										Add
									</Button>
								</div>
							)}

							<div className="flex flex-wrap gap-2">
								{blacklist.map((word) => (
									<div
										key={word.id}
										className="flex items-center gap-1 px-3 py-1 rounded-full bg-destructive/10 text-destructive text-sm"
									>
										<span>{word.word}</span>
										{canEdit && (
											<button
												type="button"
												className="ml-1 hover:text-destructive/80"
												onClick={() => handleRemoveBlacklistWord(word.id)}
											>
												&times;
											</button>
										)}
									</div>
								))}
								{blacklist.length === 0 && (
									<p className="text-muted-foreground text-sm">
										No blacklist words
									</p>
								)}
							</div>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="settings" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Prefix Settings</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<span className="text-sm font-medium">Max Length</span>
									<Input
										disabled={!canEdit}
										type="number"
										value={settings.max_length}
										onChange={(e) =>
											setSettings({ ...settings, max_length: e.target.value })
										}
									/>
								</div>
								<div className="space-y-2">
									<span className="text-sm font-medium">Minimum Rank</span>
									<Input
										disabled={!canEdit}
										type="number"
										value={settings.min_rank_to_buy}
										onChange={(e) =>
											setSettings({
												...settings,
												min_rank_to_buy: e.target.value,
											})
										}
									/>
								</div>
								<div className="space-y-2">
									<span className="text-sm font-medium">Price (Credits)</span>
									<Input
										disabled={!canEdit}
										type="number"
										value={settings.price_credits}
										onChange={(e) =>
											setSettings({
												...settings,
												price_credits: e.target.value,
											})
										}
									/>
								</div>
								<div className="space-y-2">
									<span className="text-sm font-medium">Price (Points)</span>
									<Input
										disabled={!canEdit}
										type="number"
										value={settings.price_points}
										onChange={(e) =>
											setSettings({ ...settings, price_points: e.target.value })
										}
									/>
								</div>
								<div className="space-y-2">
									<span className="text-sm font-medium">Points Type</span>
									<Input
										disabled={!canEdit}
										type="number"
										value={settings.points_type}
										onChange={(e) =>
											setSettings({ ...settings, points_type: e.target.value })
										}
									/>
									<p className="text-xs text-muted-foreground">
										0 = Duckets, 5 = Diamonds, etc.
									</p>
								</div>
							</div>
							{canEdit && (
								<Button disabled={isPending} onClick={saveSettings}>
									<Save className="h-4 w-4 mr-1" />
									Save Settings
								</Button>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</>
	);
}
