"use client";

import { Download, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { saveTranslations } from "@/actions/translations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServerAction } from "@/hooks/use-server-action";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import {
	type AppLocale,
	isSupportedLocale,
	SUPPORTED_LOCALES,
} from "@/i18n/locales";
import { validateCmsMessage } from "@/lib/cms-message-validation";
import type { CmsTranslationSnapshot } from "@/lib/cms-translations";
import { unflattenObject } from "@/lib/translations-utils";

interface Props {
	snapshots: Record<string, CmsTranslationSnapshot>;
	initialLocale: string;
	canEdit: boolean;
}
const PER_PAGE = 30;
export function TranslationsClient({
	snapshots,
	initialLocale,
	canEdit,
}: Props) {
	const t = useTranslations("pages.admin.translations.cms");
	const router = useRouter();
	const [saved, setSaved] = useState(snapshots);
	const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>(
		{},
	);
	const [activeLang, setActiveLang] = useState<AppLocale>(
		isSupportedLocale(initialLocale) ? initialLocale : "en",
	);
	const [search, setSearch] = useState("");
	const [group, setGroup] = useState("");
	const [status, setStatus] = useState("all");
	const [page, setPage] = useState(1);
	const { run, isPending } = useServerAction();
	const source = saved.en.messages;
	const activeData = saved[activeLang].messages;
	const draft = drafts[activeLang] ?? {};
	const keys = useMemo(() => Object.keys(source).sort(), [source]);
	const groups = useMemo(
		() => [...new Set(keys.map((key) => key.split(".")[0]))],
		[keys],
	);
	const dirty = Object.values(drafts).some(
		(values) => Object.keys(values).length > 0,
	);
	useUnsavedChanges(dirty, t("leaveWarning"));
	const valueFor = (key: string) => draft[key] ?? activeData[key] ?? "";
	const missing = keys.filter((key) => !valueFor(key).trim()).length;
	const identical =
		activeLang === "en"
			? 0
			: keys.filter((key) => valueFor(key) === source[key]).length;
	const errors: Record<string, string> = {};
	for (const [key, value] of Object.entries(draft)) {
		const issue = validateCmsMessage(value, source[key]);
		if (issue) errors[key] = t(issue, { key });
	}
	const filteredKeys = keys.filter((key) => {
		const value = valueFor(key);
		const matchesSearch = [key, value, source[key]].some((text) =>
			text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
		);
		const matchesStatus =
			status === "all" ||
			(status === "missing" && !activeData[key]?.trim()) ||
			(status === "identical" &&
				activeLang !== "en" &&
				activeData[key] === source[key]) ||
			(status === "modified" && Object.hasOwn(draft, key));
		return (
			matchesSearch && matchesStatus && (!group || key.startsWith(`${group}.`))
		);
	});
	const totalPages = Math.max(1, Math.ceil(filteredKeys.length / PER_PAGE));
	const currentPage = Math.min(page, totalPages);
	const pageKeys = filteredKeys.slice(
		(currentPage - 1) * PER_PAGE,
		currentPage * PER_PAGE,
	);
	function updateValue(key: string, value: string) {
		setDrafts((current) => {
			const next = { ...current[activeLang] };
			if (value === (activeData[key] ?? "")) delete next[key];
			else next[key] = value;
			return { ...current, [activeLang]: next };
		});
	}
	function handleSave() {
		if (!canEdit || !Object.keys(draft).length || Object.keys(errors).length)
			return;
		const locale = activeLang;
		run(
			() =>
				saveTranslations({
					locale,
					revision: saved[locale].revision,
					changes: draft,
				}),
			{
				successMessage: t("saved"),
				onSuccess: (result) => {
					const snapshot = result.snapshot as CmsTranslationSnapshot;
					setSaved((current) => ({ ...current, [locale]: snapshot }));
					setDrafts((current) => ({ ...current, [locale]: {} }));
					router.refresh();
				},
			},
		);
	}
	function handleExport() {
		const blob = new Blob(
			[JSON.stringify(unflattenObject({ ...activeData, ...draft }), null, 2)],
			{ type: "application/json" },
		);
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${activeLang}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}
	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-xl font-semibold">{t("title")}</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						{t("description")}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button variant="outline" size="sm" onClick={handleExport}>
						<Download className="mr-1 h-4 w-4" />
						{t("export")}
					</Button>
					{canEdit && (
						<Button
							size="sm"
							onClick={handleSave}
							disabled={
								isPending ||
								!Object.keys(draft).length ||
								!!Object.keys(errors).length
							}
						>
							<Save className="mr-1 h-4 w-4" />
							{isPending
								? t("saving")
								: t("saveLocale", { locale: activeLang.toUpperCase() })}
						</Button>
					)}
				</div>
			</div>
			{!canEdit && (
				<p className="text-sm text-muted-foreground">{t("readOnly")}</p>
			)}
			<fieldset disabled={isPending} className="min-w-0 space-y-4">
				<fieldset
					className="flex min-w-0 flex-wrap gap-1"
					aria-label={t("language")}
				>
					{SUPPORTED_LOCALES.map((code) => (
						<Button
							key={code}
							size="sm"
							variant={activeLang === code ? "default" : "outline"}
							aria-pressed={activeLang === code}
							onClick={() => {
								setActiveLang(code);
								setPage(1);
							}}
						>
							{code.toUpperCase()}
							{Object.keys(drafts[code] ?? {}).length ? " *" : ""}
						</Button>
					))}
				</fieldset>
				<p className="text-sm" role="status">
					{t("coverage", { total: keys.length, missing, identical })}
				</p>
				<div className="flex flex-wrap items-end gap-3">
					<label
						htmlFor="cms-translation-search"
						className="grid w-full min-w-0 gap-1 text-sm md:w-auto md:flex-1"
					>
						{t("search")}
						<Input
							id="cms-translation-search"
							type="search"
							value={search}
							onChange={(e) => {
								setSearch(e.target.value);
								setPage(1);
							}}
							placeholder={t("searchPlaceholder")}
						/>
					</label>
					<label className="grid gap-1 text-sm">
						{t("group")}
						<select
							value={group}
							onChange={(e) => {
								setGroup(e.target.value);
								setPage(1);
							}}
							className="rounded-md border bg-background px-3 py-2"
						>
							<option value="">{t("allGroups")}</option>
							{groups.map((g) => (
								<option key={g} value={g}>
									{g}
								</option>
							))}
						</select>
					</label>
					<label className="grid gap-1 text-sm">
						{t("status")}
						<select
							value={status}
							onChange={(e) => {
								setStatus(e.target.value);
								setPage(1);
							}}
							className="rounded-md border bg-background px-3 py-2"
						>
							<option value="all">{t("all")}</option>
							<option value="missing">{t("missing")}</option>
							{activeLang !== "en" && (
								<option value="identical">{t("identical")}</option>
							)}
							<option value="modified">{t("modified")}</option>
						</select>
					</label>
				</div>
				<p className="text-xs text-muted-foreground">{t("fallbackHint")}</p>
				{Object.keys(draft).length > 0 && (
					<div className="flex flex-wrap items-center gap-3">
						<span className="text-sm">
							{t("unsaved", { count: Object.keys(draft).length })}
						</span>
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								if (window.confirm(t("discardConfirm")))
									setDrafts((current) => ({ ...current, [activeLang]: {} }));
							}}
						>
							{t("discard")}
						</Button>
						{Object.keys(errors).length > 0 && (
							<span role="alert" className="text-sm text-destructive">
								{t("fixErrors", { count: Object.keys(errors).length })}
							</span>
						)}
					</div>
				)}
				<div className="divide-y rounded-lg border bg-card">
					{pageKeys.length === 0 && (
						<p className="p-6 text-sm text-muted-foreground">
							{t("noResults")}
						</p>
					)}
					{pageKeys.map((key) => (
						<div key={key} className="grid min-w-0 gap-2 p-4">
							<label
								htmlFor={`translation-${key}`}
								className="break-all font-mono text-xs text-muted-foreground"
							>
								{key}
							</label>
							{activeLang !== "en" && (
								<p className="whitespace-pre-wrap break-words text-sm">
									<span className="font-medium">{t("source")}: </span>
									{source[key]}
								</p>
							)}
							<textarea
								id={`translation-${key}`}
								aria-invalid={!!errors[key]}
								aria-describedby={errors[key] ? `error-${key}` : undefined}
								readOnly={!canEdit}
								value={valueFor(key)}
								onChange={(e) => updateValue(key, e.target.value)}
								placeholder={t("missingPlaceholder")}
								rows={2}
								className="w-full min-w-0 resize-y rounded-md border bg-background px-3 py-2 text-sm"
							/>
							{errors[key] && (
								<p
									id={`error-${key}`}
									role="alert"
									className="break-words text-sm text-destructive"
								>
									{errors[key]}
								</p>
							)}
						</div>
					))}
				</div>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<span className="text-sm text-muted-foreground">
						{t("page", {
							page: currentPage,
							total: totalPages,
							count: filteredKeys.length,
						})}
					</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={currentPage <= 1}
							onClick={() => setPage(currentPage - 1)}
						>
							{t("previous")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={currentPage >= totalPages}
							onClick={() => setPage(currentPage + 1)}
						>
							{t("next")}
						</Button>
					</div>
				</div>
			</fieldset>
		</div>
	);
}
