"use client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	deleteTableView,
	listTableViews,
	saveTableView,
} from "@/actions/admin-table-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	captureTableView,
	type NamedTableView,
} from "@/lib/admin/table-view-state";

export function TableSavedViews({
	path,
	query,
	hidden,
	onApply,
}: {
	path: string;
	query: string;
	hidden: string[];
	onApply: (view: NamedTableView) => void;
}) {
	const inputId = useId();
	const t = useTranslations("pages.admin.table.views");
	const [views, setViews] = useState<NamedTableView[]>([]);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [error, setError] = useState(false);
	async function load() {
		setBusy(true);
		setError(false);
		setLoaded(false);
		setViews([]);
		try {
			const result = await listTableViews({ path });
			if (!result.ok) throw new Error(result.error);
			setViews((result.data as { views: NamedTableView[] }).views);
			setLoaded(true);
		} catch {
			setError(true);
		} finally {
			setBusy(false);
		}
	}
	async function save() {
		if (busy || !name.trim()) return;
		setBusy(true);
		try {
			const result = await saveTableView({
				path,
				name: name.trim(),
				state: captureTableView(query, hidden),
			});
			if (!result.ok) throw new Error(result.error);
			toast.success(t("saved"));
			setName("");
			await load();
		} catch {
			toast.error(t("error"));
		} finally {
			setBusy(false);
		}
	}
	async function remove(view: NamedTableView) {
		if (busy) return;
		setBusy(true);
		try {
			const result = await deleteTableView({ path, name: view.name });
			if (!result.ok) throw new Error(result.error);
			await load();
		} catch {
			toast.error(t("error"));
		} finally {
			setBusy(false);
		}
	}
	return (
		<Popover
			onOpenChange={(open) => {
				if (open) void load();
			}}
		>
			<PopoverTrigger asChild>
				<Button variant="outline" size="sm">
					{t("title")}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="w-80 max-w-[calc(100vw-2rem)] space-y-3"
			>
				<p className="text-sm text-muted-foreground">{t("hint")}</p>
				{error && (
					<p role="alert" className="text-sm">
						{t("error")}{" "}
						<Button variant="link" size="sm" onClick={() => void load()}>
							{t("retry")}
						</Button>
					</p>
				)}
				{busy && (
					<p role="status" className="text-sm">
						{t("loading")}
					</p>
				)}
				{loaded && views.length === 0 && (
					<p className="text-sm text-muted-foreground">{t("empty")}</p>
				)}
				<div className="max-h-60 overflow-y-auto space-y-1">
					{views.map((view) => (
						<div key={view.name} className="flex gap-2 items-center">
							<Button
								disabled={busy}
								variant="secondary"
								className="flex-1 min-w-0 justify-start"
								onClick={() => onApply(view)}
							>
								<span className="truncate">{view.name}</span>
							</Button>
							<Button
								disabled={busy}
								variant="ghost"
								size="sm"
								aria-label={t("deleteNamed", { name: view.name })}
								onClick={() => void remove(view)}
							>
								{t("delete")}
							</Button>
						</div>
					))}
				</div>
				<label htmlFor={inputId} className="block text-sm">
					{t("name")}
					<Input
						id={inputId}
						value={name}
						maxLength={60}
						onChange={(event) => setName(event.target.value)}
					/>
				</label>
				<Button
					disabled={busy || !loaded || !name.trim()}
					onClick={() => void save()}
					className="w-full"
				>
					{views.some(
						(view) =>
							view.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
					)
						? t("replace")
						: t("save")}
				</Button>
			</PopoverContent>
		</Popover>
	);
}
