"use client";
import { Package } from "lucide-react";
import { useTranslations } from "next-intl";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { catalogDuplicateDestinations } from "@/actions/catalog-duplicate";
import {
	createCatalogPackage,
	getCatalogPackage,
	listCatalogPackages,
	previewCatalogPackage,
	publishCatalogPackage,
	saveCatalogPackage,
} from "@/actions/catalog-packages";
import { MovePageCombobox } from "@/components/admin/catalog/catalog-items-table/field-helpers";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type {
	CatalogPackage,
	PackageListRow,
	PackageOffer,
	PackagePage,
	PackagePreview,
	PackageSnapshot,
} from "../../domain/packages";

type Category = { id: number; caption: string };
type View = { kind: "none" } | { kind: "create" } | { kind: "edit" };

const OFFERS_PER_PAGE = 25;
const PAGE_NUMBER_FIELDS = ["iconImage", "minRank", "orderNum"] as const;
const PAGE_FLAG_FIELDS = ["enabled", "visible", "clubOnly", "vipOnly"] as const;
const OFFER_NUMBER_FIELDS = [
	"costCredits",
	"costPoints",
	"pointsType",
	"amount",
] as const;
const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

function isWhole(value: number): boolean {
	return Number.isInteger(value) && value >= INT_MIN && value <= INT_MAX;
}

/** Required names and layouts, whole numbers: the same rules the server applies (domain/packages.ts). */
function draftIsValid(name: string, draft: PackageSnapshot): boolean {
	if (!name.trim() || name.trim().length > 128) return false;
	for (const page of draft.pages) {
		if (!page.caption.trim() || page.caption.length > 128) return false;
		if (!page.pageLayout.trim() || page.pageLayout.length > 26) return false;
		if (PAGE_NUMBER_FIELDS.some((field) => !isWhole(page[field]))) return false;
	}
	for (const offer of draft.offers) {
		if (offer.catalogName.length > 100) return false;
		if (OFFER_NUMBER_FIELDS.some((field) => !isWhole(offer[field])))
			return false;
	}
	return true;
}

/** Fields that differ from the saved baseline, for the before/after review. */
function draftChanges(baseline: PackageSnapshot, draft: PackageSnapshot) {
	const rows: {
		entry: string;
		field: string;
		before: string;
		after: string;
	}[] = [];
	const pages = new Map(baseline.pages.map((page) => [page.id, page]));
	for (const page of draft.pages) {
		const before = pages.get(page.id);
		if (!before) continue;
		for (const field of Object.keys(page) as (keyof PackagePage)[]) {
			if (before[field] !== page[field])
				rows.push({
					entry: `${before.caption} (#${page.id})`,
					field,
					before: String(before[field]),
					after: String(page[field]),
				});
		}
	}
	const offers = new Map(baseline.offers.map((offer) => [offer.id, offer]));
	for (const offer of draft.offers) {
		const before = offers.get(offer.id);
		if (!before) continue;
		for (const field of Object.keys(offer) as (keyof PackageOffer)[]) {
			if (before[field] !== offer[field])
				rows.push({
					entry: `${before.catalogName || "#"} (#${offer.id})`,
					field,
					before: String(before[field]),
					after: String(offer[field]),
				});
		}
	}
	return rows;
}

/**
 * Catalog packages: prepare category and price changes in a draft, review them and publish them to the
 * live catalog in one step (src/actions/catalog-packages.ts).
 */
export function CatalogPackagesDialog({ canEdit }: { canEdit: boolean }) {
	const t = useTranslations("pages.admin.catalog.packages");
	const [open, setOpen] = useState(false);
	const [packages, setPackages] = useState<PackageListRow[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [search, setSearch] = useState("");
	const [view, setView] = useState<View>({ kind: "none" });
	const [busy, setBusy] = useState(false);
	const pending = useRef(false);
	const editNameId = useId();

	// The open package and its unsaved edits.
	const [current, setCurrent] = useState<CatalogPackage | null>(null);
	const [name, setName] = useState("");
	const [targetParentId, setTargetParentId] = useState<number | null>(-1);
	const [draft, setDraft] = useState<PackageSnapshot | null>(null);
	const [dirty, setDirty] = useState(false);
	const [preview, setPreview] = useState<PackagePreview | null>(null);
	const [showBaseline, setShowBaseline] = useState(false);

	// A new draft.
	const [newName, setNewName] = useState("");
	const [newMode, setNewMode] = useState<"update" | "copy">("update");
	const [newPages, setNewPages] = useState<number[]>([]);
	const [newParent, setNewParent] = useState<number | null>(-1);
	const [categorySearch, setCategorySearch] = useState("");

	const run = useCallback(
		async <T,>(
			operation: () => Promise<
				{ ok: true; data: T } | { ok: false; error: string }
			>,
		): Promise<T | null> => {
			if (pending.current) return null;
			pending.current = true;
			setBusy(true);
			try {
				const result = await operation();
				if (!result.ok) {
					toast.error(result.error || t("requestFailed"));
					return null;
				}
				return result.data;
			} catch {
				toast.error(t("requestFailed"));
				return null;
			} finally {
				pending.current = false;
				setBusy(false);
			}
		},
		[t],
	);

	const refresh = useCallback(async () => {
		const list = await run(() => listCatalogPackages());
		if (list) setPackages(list);
	}, [run]);

	useEffect(() => {
		if (!open) return;
		void refresh();
		void catalogDuplicateDestinations("normal")
			.then((result) => {
				if (result.ok) setCategories(result.data);
				else toast.error(result.error);
			})
			.catch(() => toast.error(t("requestFailed")));
	}, [open, refresh, t]);

	function confirmDiscard(): boolean {
		return !dirty || window.confirm(t("discardChanges"));
	}

	async function openPackage(id: string) {
		if (!confirmDiscard()) return;
		const pkg = await run(() => getCatalogPackage(id));
		if (!pkg) return;
		setCurrent(pkg);
		setName(pkg.name);
		setTargetParentId(pkg.targetParentId);
		setDraft(pkg.draft);
		setDirty(false);
		setPreview(null);
		setShowBaseline(false);
		setView({ kind: "edit" });
	}

	async function createDraft() {
		const created = await run(() =>
			createCatalogPackage({
				name: newName.trim(),
				pageIds: newPages,
				mode: newMode,
				targetParentId: newMode === "copy" ? (newParent ?? -1) : -1,
			}),
		);
		if (!created) return;
		toast.success(t("draftCreated"));
		setNewName("");
		setNewPages([]);
		await refresh();
		await openPackage(created.id);
	}

	async function saveDraft() {
		if (!current || !draft) return;
		if (!draftIsValid(name, draft)) {
			toast.error(t("invalidFields"));
			return;
		}
		const saved = await run(() =>
			saveCatalogPackage({
				id: current.id,
				version: current.version,
				name: name.trim(),
				draft,
				targetParentId: targetParentId ?? -1,
			}),
		);
		if (!saved) return;
		toast.success(t("draftSaved"));
		setDirty(false);
		setPreview(null);
		await refresh();
		await openPackage(current.id);
	}

	async function reviewPublication() {
		if (!current) return;
		const result = await run(() => previewCatalogPackage(current.id));
		if (result) setPreview(result);
	}

	async function publish() {
		if (!current || !preview || preview.conflicts.length > 0) return;
		if (preview.version !== current.version) {
			toast.error(t("staleReview"));
			return;
		}
		if (!window.confirm(t("confirmPublish"))) return;
		const result = await run(() =>
			publishCatalogPackage({
				id: current.id,
				version: current.version,
				fingerprint: preview.fingerprint,
			}),
		);
		if (!result) return;
		toast.success(
			t("publishedSuccess", {
				pages: result.pageIds.length,
				offers: result.offerCount,
			}),
		);
		for (const warning of result.warnings ?? []) toast.warning(warning);
		setPreview(null);
		await refresh();
		await openPackage(current.id);
	}

	function editPage(id: number, change: Partial<PackagePage>) {
		setDraft((value) =>
			value
				? {
						...value,
						pages: value.pages.map((page) =>
							page.id === id ? { ...page, ...change } : page,
						),
					}
				: value,
		);
		setDirty(true);
		setPreview(null);
	}

	function editOffer(id: number, change: Partial<PackageOffer>) {
		setDraft((value) =>
			value
				? {
						...value,
						offers: value.offers.map((offer) =>
							offer.id === id ? { ...offer, ...change } : offer,
						),
					}
				: value,
		);
		setDirty(true);
		setPreview(null);
	}

	const shownPackages = packages.filter((row) =>
		row.name.toLowerCase().includes(search.trim().toLowerCase()),
	);
	const editable =
		canEdit && current?.status === "draft" && view.kind === "edit";

	return (
		<>
			<Button variant="outline" onClick={() => setOpen(true)}>
				<Package className="h-3.5 w-3.5" />
				{t("openPackages")}
			</Button>
			<Dialog
				open={open}
				onOpenChange={(value) => {
					if (!value && !pending.current && confirmDiscard()) {
						setOpen(false);
						setDirty(false);
					}
				}}
			>
				<DialogContent
					className="max-h-[90vh] max-w-6xl overflow-y-auto"
					style={{
						backgroundColor: "var(--admin-surface)",
						color: "var(--admin-text)",
					}}
				>
					<DialogHeader>
						<DialogTitle>{t("title")}</DialogTitle>
						<DialogDescription>{t("description")}</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 md:grid-cols-[16rem_1fr]">
						<aside className="space-y-2">
							<div className="flex gap-2">
								{canEdit && (
									<Button
										size="sm"
										disabled={busy}
										onClick={() => {
											if (confirmDiscard()) {
												setDirty(false);
												setView({ kind: "create" });
											}
										}}
									>
										{t("createPackage")}
									</Button>
								)}
								<Button
									size="sm"
									variant="outline"
									disabled={busy}
									onClick={() => void refresh()}
								>
									{t("refresh")}
								</Button>
							</div>
							<Input
								value={search}
								placeholder={t("searchPackages")}
								aria-label={t("searchPackages")}
								onChange={(e) => setSearch(e.target.value)}
							/>
							<ul className="max-h-[60vh] space-y-1 overflow-y-auto">
								{shownPackages.length === 0 && (
									<li className="text-sm text-muted-foreground">
										{t("noPackages")}
									</li>
								)}
								{shownPackages.map((row) => (
									<li key={row.id}>
										<button
											type="button"
											disabled={busy}
											onClick={() => void openPackage(row.id)}
											className={`w-full rounded-md border px-2 py-1.5 text-left text-sm hover:bg-[var(--admin-accent)]/10 ${
												current?.id === row.id && view.kind === "edit"
													? "border-[var(--admin-accent)]"
													: "border-[var(--admin-border)]"
											}`}
										>
											<span className="block truncate font-medium">
												{row.name}
											</span>
											<span className="text-xs text-muted-foreground">
												{row.status === "draft" ? t("draft") : t("published")} ·{" "}
												{row.mode === "copy" ? t("copy") : t("update")}
											</span>
										</button>
									</li>
								))}
							</ul>
						</aside>
						<section className="min-w-0 space-y-4">
							{view.kind === "none" && (
								<p className="text-sm text-muted-foreground">
									{t("choosePackage")}
								</p>
							)}
							{view.kind === "create" && (
								<CreatePackageForm
									t={t}
									busy={busy}
									categories={categories}
									name={newName}
									onName={setNewName}
									mode={newMode}
									onMode={setNewMode}
									selected={newPages}
									onSelected={setNewPages}
									parent={newParent}
									onParent={setNewParent}
									categorySearch={categorySearch}
									onCategorySearch={setCategorySearch}
									onCreate={() => void createDraft()}
								/>
							)}
							{view.kind === "edit" && current && draft && (
								<>
									<div className="flex flex-wrap items-end gap-3">
										<label htmlFor={editNameId} className="grid gap-1 text-sm">
											{t("name")}
											<Input
												id={editNameId}
												value={name}
												maxLength={128}
												disabled={!editable || busy}
												onChange={(e) => {
													setName(e.target.value);
													setDirty(true);
													setPreview(null);
												}}
											/>
										</label>
										<p className="text-sm">
											{t("mode")}:{" "}
											{current.mode === "copy" ? t("copy") : t("update")} ·{" "}
											{current.status === "draft" ? t("draft") : t("published")}
											{dirty && (
												<span className="ml-2 text-[var(--admin-accent)]">
													{t("unsaved")}
												</span>
											)}
										</p>
									</div>
									<p className="text-xs text-muted-foreground">
										{current.mode === "copy" ? t("copyHint") : t("updateHint")}
									</p>
									{current.mode === "copy" && (
										<div className="grid gap-1 text-sm">
											<p>{t("targetParent")}</p>
											<MovePageCombobox
												value={targetParentId}
												onChange={(id) => {
													setTargetParentId(id);
													setDirty(true);
													setPreview(null);
												}}
												pages={[
													{ id: -1, caption: t("rootCategory") },
													...categories,
												]}
												currentPageId={-2}
												disabled={!editable || busy}
												labels={{
													placeholder: t("targetParent"),
													search: t("searchCategories"),
													empty: t("noPackages"),
													suggested: t("targetParent"),
													all: t("rootCategory"),
												}}
											/>
										</div>
									)}
									<PagesTable
										t={t}
										pages={showBaseline ? current.baseline.pages : draft.pages}
										editable={editable && !showBaseline}
										busy={busy}
										onEdit={editPage}
									/>
									<OffersTable
										t={t}
										offers={
											showBaseline ? current.baseline.offers : draft.offers
										}
										pages={draft.pages}
										editable={editable && !showBaseline}
										busy={busy}
										onEdit={editOffer}
									/>
									<label className="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											checked={showBaseline}
											onChange={(e) => setShowBaseline(e.target.checked)}
										/>
										{t("showBaseline")}
									</label>
									<ChangesTable
										t={t}
										mode={current.mode}
										changes={draftChanges(current.baseline, draft)}
									/>
									{editable && (
										<div className="space-y-2 rounded-md border border-[var(--admin-border)] p-3">
											<p className="text-xs text-muted-foreground">
												{t("saveHint")}
											</p>
											<div className="flex flex-wrap gap-2">
												<Button
													disabled={busy || !dirty}
													onClick={() => void saveDraft()}
												>
													{busy ? t("working") : t("saveDraft")}
												</Button>
												<Button
													variant="outline"
													disabled={busy || dirty}
													onClick={() => void reviewPublication()}
												>
													{t("reviewPublication")}
												</Button>
											</div>
											{preview && (
												<div className="space-y-2 text-sm" role="status">
													<p>
														{t("publicationImpact", {
															pages: preview.changedPages,
															offers: preview.changedOffers,
														})}
													</p>
													{preview.conflicts.length > 0 ? (
														<>
															<p className="text-destructive">{t("conflicts")}</p>
															<ul className="list-disc pl-5">
																{preview.conflicts.map((conflict) => (
																	<li key={conflict}>{conflict}</li>
																))}
															</ul>
														</>
													) : (
														<>
															<p>{t("readyToPublish")}</p>
															<Button
																disabled={busy}
																onClick={() => void publish()}
															>
																{t("publish")}
															</Button>
														</>
													)}
												</div>
											)}
										</div>
									)}
								</>
							)}
						</section>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

type T = ReturnType<typeof useTranslations>;

function CreatePackageForm(props: {
	t: T;
	busy: boolean;
	categories: Category[];
	name: string;
	onName: (value: string) => void;
	mode: "update" | "copy";
	onMode: (value: "update" | "copy") => void;
	selected: number[];
	onSelected: (value: number[]) => void;
	parent: number | null;
	onParent: (value: number | null) => void;
	categorySearch: string;
	onCategorySearch: (value: string) => void;
	onCreate: () => void;
}) {
	const { t } = props;
	const nameId = useId();
	const shown = useMemo(() => {
		const query = props.categorySearch.trim().toLowerCase();
		return props.categories
			.filter(
				(category) =>
					!query ||
					category.caption.toLowerCase().includes(query) ||
					String(category.id) === query,
			)
			.slice(0, 200);
	}, [props.categories, props.categorySearch]);
	const selected = new Set(props.selected);
	return (
		<div className="space-y-3">
			<label htmlFor={nameId} className="grid gap-1 text-sm">
				{t("name")}
				<Input
					id={nameId}
					value={props.name}
					maxLength={128}
					disabled={props.busy}
					onChange={(e) => props.onName(e.target.value)}
				/>
			</label>
			<fieldset className="space-y-1 text-sm">
				<legend>{t("mode")}</legend>
				{(["update", "copy"] as const).map((mode) => (
					<label key={mode} className="flex items-start gap-2">
						<input
							type="radio"
							name="package-mode"
							checked={props.mode === mode}
							onChange={() => props.onMode(mode)}
						/>
						<span>
							{t(mode)}
							<span className="block text-xs text-muted-foreground">
								{t(mode === "copy" ? "copyHint" : "updateHint")}
							</span>
						</span>
					</label>
				))}
			</fieldset>
			{props.mode === "copy" && (
				<div className="grid gap-1 text-sm">
					<p>{t("targetParent")}</p>
					<MovePageCombobox
						value={props.parent}
						onChange={props.onParent}
						pages={[
							{ id: -1, caption: t("rootCategory") },
							...props.categories,
						]}
						currentPageId={-2}
						disabled={props.busy}
						labels={{
							placeholder: t("targetParent"),
							search: t("searchCategories"),
							empty: t("noPackages"),
							suggested: t("targetParent"),
							all: t("rootCategory"),
						}}
					/>
				</div>
			)}
			<div className="space-y-1 text-sm">
				<p>{t("sourceCategories")}</p>
				<p className="text-xs text-muted-foreground">{t("packageLimits")}</p>
				<Input
					value={props.categorySearch}
					placeholder={t("searchCategories")}
					aria-label={t("searchCategories")}
					onChange={(e) => props.onCategorySearch(e.target.value)}
				/>
				<p className="text-xs">
					{t("selectedCategories", { count: props.selected.length })}
				</p>
				<ul className="max-h-60 overflow-y-auto rounded-md border border-[var(--admin-border)] p-2">
					{shown.map((category) => (
						<li key={category.id}>
							<label className="flex items-center gap-2">
								<input
									type="checkbox"
									checked={selected.has(category.id)}
									disabled={
										props.busy ||
										(!selected.has(category.id) && props.selected.length >= 200)
									}
									onChange={(e) =>
										props.onSelected(
											e.target.checked
												? [...props.selected, category.id]
												: props.selected.filter((id) => id !== category.id),
										)
									}
								/>
								<span className="truncate">
									{category.caption}{" "}
									<span className="text-xs text-muted-foreground">
										#{category.id}
									</span>
								</span>
							</label>
						</li>
					))}
				</ul>
			</div>
			<Button
				disabled={
					props.busy ||
					!props.name.trim() ||
					props.selected.length === 0 ||
					(props.mode === "copy" && props.parent === null)
				}
				onClick={props.onCreate}
			>
				{props.busy ? t("working") : t("createDraft")}
			</Button>
		</div>
	);
}

function numberValue(raw: string): number {
	return raw.trim() === "" ? Number.NaN : Number(raw);
}

function PagesTable(props: {
	t: T;
	pages: PackagePage[];
	editable: boolean;
	busy: boolean;
	onEdit: (id: number, change: Partial<PackagePage>) => void;
}) {
	const { t } = props;
	return (
		<div className="overflow-x-auto">
			<table className="w-full text-sm">
				<thead>
					<tr className="text-left text-xs text-muted-foreground">
						<th className="p-1">{t("category")}</th>
						<th className="p-1">{t("caption")}</th>
						<th className="p-1">{t("pageLayout")}</th>
						{PAGE_NUMBER_FIELDS.map((field) => (
							<th key={field} className="p-1">
								{t(field)}
							</th>
						))}
						{PAGE_FLAG_FIELDS.map((field) => (
							<th key={field} className="p-1">
								{t(field)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{props.pages.map((page) => (
						<tr key={page.id} className="border-t border-[var(--admin-border)]">
							<td className="p-1 text-xs">#{page.id}</td>
							<td className="p-1">
								<Input
									value={page.caption}
									maxLength={128}
									disabled={!props.editable || props.busy}
									aria-label={t("caption")}
									onChange={(e) =>
										props.onEdit(page.id, { caption: e.target.value })
									}
								/>
							</td>
							<td className="p-1">
								<Input
									value={page.pageLayout}
									maxLength={26}
									disabled={!props.editable || props.busy}
									aria-label={t("pageLayout")}
									onChange={(e) =>
										props.onEdit(page.id, { pageLayout: e.target.value })
									}
								/>
							</td>
							{PAGE_NUMBER_FIELDS.map((field) => (
								<td key={field} className="p-1">
									<Input
										type="number"
										className="w-24"
										value={Number.isNaN(page[field]) ? "" : page[field]}
										disabled={!props.editable || props.busy}
										aria-label={t(field)}
										onChange={(e) =>
											props.onEdit(page.id, {
												[field]: numberValue(e.target.value),
											})
										}
									/>
								</td>
							))}
							{PAGE_FLAG_FIELDS.map((field) => (
								<td key={field} className="p-1 text-center">
									<input
										type="checkbox"
										checked={page[field] === "1"}
										disabled={!props.editable || props.busy}
										aria-label={t(field)}
										onChange={(e) =>
											props.onEdit(page.id, {
												[field]: e.target.checked ? "1" : "0",
											})
										}
									/>
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function OffersTable(props: {
	t: T;
	offers: PackageOffer[];
	pages: PackagePage[];
	editable: boolean;
	busy: boolean;
	onEdit: (id: number, change: Partial<PackageOffer>) => void;
}) {
	const { t } = props;
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(0);
	const captions = new Map(props.pages.map((p) => [p.id, p.caption]));
	const shown = props.offers.filter((offer) => {
		const q = query.trim().toLowerCase();
		return (
			!q ||
			offer.catalogName.toLowerCase().includes(q) ||
			String(offer.id) === q ||
			(captions.get(offer.pageId) ?? "").toLowerCase().includes(q)
		);
	});
	const pages = Math.max(1, Math.ceil(shown.length / OFFERS_PER_PAGE));
	const at = Math.min(page, pages - 1);
	const slice = shown.slice(at * OFFERS_PER_PAGE, (at + 1) * OFFERS_PER_PAGE);
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-sm font-semibold">
					{t("offers", { count: props.offers.length })}
				</h3>
				<Input
					className="max-w-xs"
					value={query}
					placeholder={t("searchOffers")}
					aria-label={t("searchOffers")}
					onChange={(e) => {
						setQuery(e.target.value);
						setPage(0);
					}}
				/>
			</div>
			{slice.length === 0 ? (
				<p className="text-sm text-muted-foreground">{t("noOffers")}</p>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="text-left text-xs text-muted-foreground">
								<th className="p-1">{t("offer")}</th>
								<th className="p-1">{t("category")}</th>
								<th className="p-1">{t("catalogName")}</th>
								{OFFER_NUMBER_FIELDS.map((field) => (
									<th key={field} className="p-1">
										{t(field)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{slice.map((offer) => (
								<tr
									key={offer.id}
									className="border-t border-[var(--admin-border)]"
								>
									<td className="p-1 text-xs">#{offer.id}</td>
									<td className="p-1 text-xs">
										{captions.get(offer.pageId) ?? `#${offer.pageId}`}
									</td>
									<td className="p-1">
										<Input
											value={offer.catalogName}
											maxLength={100}
											disabled={!props.editable || props.busy}
											aria-label={t("catalogName")}
											onChange={(e) =>
												props.onEdit(offer.id, { catalogName: e.target.value })
											}
										/>
									</td>
									{OFFER_NUMBER_FIELDS.map((field) => (
										<td key={field} className="p-1">
											<Input
												type="number"
												className="w-24"
												value={Number.isNaN(offer[field]) ? "" : offer[field]}
												disabled={!props.editable || props.busy}
												aria-label={t(field)}
												onChange={(e) =>
													props.onEdit(offer.id, {
														[field]: numberValue(e.target.value),
													})
												}
											/>
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{pages > 1 && (
				<div className="flex items-center gap-2 text-sm">
					<Button
						size="sm"
						variant="outline"
						disabled={at === 0}
						onClick={() => setPage(at - 1)}
					>
						{t("previous")}
					</Button>
					<span>
						{at + 1} / {pages}
					</span>
					<Button
						size="sm"
						variant="outline"
						disabled={at >= pages - 1}
						onClick={() => setPage(at + 1)}
					>
						{t("next")}
					</Button>
				</div>
			)}
		</div>
	);
}

function ChangesTable(props: {
	t: T;
	mode: "update" | "copy";
	changes: { entry: string; field: string; before: string; after: string }[];
}) {
	const { t } = props;
	return (
		<div className="space-y-2">
			<h3 className="text-sm font-semibold">{t("changes")}</h3>
			<p className="text-xs text-muted-foreground">
				{props.mode === "copy" ? t("copyReview") : t("updateReview")}
			</p>
			{props.changes.length === 0 ? (
				<p className="text-sm text-muted-foreground">{t("noChanges")}</p>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="text-left text-xs text-muted-foreground">
								<th className="p-1">{t("entry")}</th>
								<th className="p-1">{t("field")}</th>
								<th className="p-1">{t("before")}</th>
								<th className="p-1">{t("after")}</th>
							</tr>
						</thead>
						<tbody>
							{props.changes.map((change) => (
								<tr
									key={`${change.entry}-${change.field}`}
									className="border-t border-[var(--admin-border)]"
								>
									<td className="p-1">{change.entry}</td>
									<td className="p-1">{change.field}</td>
									<td className="p-1">{change.before}</td>
									<td className="p-1">{change.after}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
