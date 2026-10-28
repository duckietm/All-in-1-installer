"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFormRecovery } from "@/hooks/use-form-recovery";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import type { ArticleDraft } from "@/lib/article-draft";
import type { ArticleSaveResult } from "@/lib/article-input";
import { type ArticleRequest, articleRequest } from "@/lib/article-request";
import { slugify } from "@/lib/format";
import { publicationIssues } from "@/lib/publication-preflight";
import { ArticlePreview, type ArticlePreviewData } from "./article-preview";
import { useArticleRecovery } from "./article-recovery";
import { FormFieldError, useFormErrorFocus } from "./form-feedback";
import { MediaPicker } from "./media-picker";
import { PublicationPreflight } from "./publication-preflight";
import { RichText } from "./rich-text";

export function ArticleForm({
	action,
	userId,
	defaultValues,
	articleKey = "new",
	baseToken = "",
}: {
	action: (formData: FormData) => Promise<ArticleSaveResult | undefined>;
	userId?: string;
	edit?: boolean;
	articleKey?: string;
	baseToken?: string;
	defaultValues?: {
		title?: string;
		slug?: string;
		image?: string;
		shortStory?: string;
		fullStory?: string;
		status?: string;
		publishAt?: string;
	};
}) {
	const t = useTranslations("pages.admin.articles.form");
	const tAction = useTranslations("pages.admin.actions");
	const [dirty, setDirty] = useState(false);
	const [pending, startTransition] = useTransition();
	const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
	const [saveError, setSaveError] = useState<string | null>(null);
	const router = useRouter();
	const saving = useRef(false);
	const request = useRef<ArticleRequest | undefined>(undefined);
	const requestScope = `${userId ?? "current"}:${articleKey}`;
	const editVersion = useRef(0);
	function markDirty() {
		localRecovery.changed();
		editVersion.current++;
		setDirty(true);
	}
	useUnsavedChanges(dirty, tAction("leaveUnsaved"));
	const [title, setTitle] = useState(defaultValues?.title ?? "");
	const [slug, setSlug] = useState(defaultValues?.slug ?? "");
	const [slugTouched, setSlugTouched] = useState(Boolean(defaultValues?.slug));
	const [image, setImage] = useState(defaultValues?.image ?? "");
	const [imageError, setImageError] = useState(false);
	const [status, setStatus] = useState(defaultValues?.status ?? "published");
	const [publishAt, setPublishAt] = useState("");
	useEffect(() => {
		if (!defaultValues?.publishAt) return;
		const date = new Date(defaultValues.publishAt);
		if (Number.isNaN(date.getTime())) return;
		const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
		setPublishAt(local.toISOString().slice(0, 16));
	}, [defaultValues?.publishAt]);

	const formRef = useRef<HTMLFormElement>(null);
	const [token, setToken] = useState(baseToken);
	const [summary, setSummary] = useState(defaultValues?.shortStory ?? "");
	const [body, setBody] = useState(defaultValues?.fullStory ?? "");
	const [bodyVersion, setBodyVersion] = useState(0);
	function restoreDraft(draft: ArticleDraft, revision: boolean) {
		setTitle(draft.title);
		setSlug(draft.slug);
		setSlugTouched(true);
		setImage(draft.image);
		setImageError(false);
		setSummary(draft.shortStory);
		setBody(draft.fullStory);
		setBodyVersion((v) => v + 1);
		setStatus("draft");
		setPublishAt("");
		setToken(revision ? baseToken : draft.baseToken);
		markDirty();
	}
	const recovery = useArticleRecovery(
		articleKey,
		formRef,
		saving,
		dirty,
		restoreDraft,
	);
	const localRecovery = useFormRecovery({
		serverDraft: recovery.draft,
		userId,
		kind: "article",
		record: articleKey,
		dirty,
		snapshot: () => ({
			title,
			slug: slugTouched ? slug : slugify(title),
			image,
			shortStory: summary,
			fullStory: body,
			status,
			publishAt,
		}),
		restore: (payload) =>
			restoreDraft({ ...payload, baseToken } as ArticleDraft, false),
	});
	useFormErrorFocus(formRef, fieldErrors, pending);
	const [preview, setPreview] = useState<ArticlePreviewData | null>(null);
	const suggestedSlug = useMemo(() => slugify(title), [title]);
	const effectiveSlug = slugify(slugTouched ? slug : suggestedSlug);
	const issues = publicationIssues({
		kind: "article",
		image,
		body,
		slug: slugTouched ? slug : suggestedSlug,
		normalizedSlug: effectiveSlug,
		status,
		publishAt,
	});

	return (
		<form
			ref={formRef}
			onChangeCapture={() => {
				markDirty();
				if (formRef.current)
					setBody(String(new FormData(formRef.current).get("fullStory") ?? ""));
			}}
			onSubmit={(event) => {
				event.preventDefault();
				if (
					saving.current ||
					(status !== "draft" &&
						issues.some((issue) => issue.severity === "error"))
				)
					return;
				const data = new FormData(event.currentTarget);
				if (status === "scheduled" && publishAt) {
					const date = new Date(publishAt);
					if (!Number.isNaN(date.getTime()))
						data.set("publishAt", date.toISOString());
				}
				localRecovery.flush();
				const submittedVersion = editVersion.current;
				saving.current = true;
				setSaveError(null);
				setFieldErrors({});
				startTransition(async () => {
					try {
						await recovery.wait();
						let storage: Storage | undefined;
						try {
							storage = window.sessionStorage;
						} catch {
							/* Storage may be disabled. */
						}
						request.current = await articleRequest(
							data,
							requestScope,
							request.current,
							storage,
						);
						data.set("requestKey", request.current.key);
						const result = await action(data);
						if (result && !result.ok) {
							setSaveError(result.error);
							setFieldErrors(result.fieldErrors ?? {});
							return;
						}
						if (result?.ok && editVersion.current === submittedVersion) {
							setDirty(false);
							localRecovery.clear();
						}
						if (result?.ok) {
							request.current = undefined;
							try {
								storage?.removeItem(`cms:news:request:${requestScope}`);
							} catch {
								/* Storage may be disabled. */
							}
							await recovery.clear().catch(() => {});
						}
						if (result?.ok && result.data?.redirectTo)
							router.push(result.data.redirectTo);
					} catch (error) {
						if (
							error &&
							typeof error === "object" &&
							"digest" in error &&
							String(error.digest).startsWith("NEXT_REDIRECT")
						) {
							setDirty(false);
							throw error;
						}
						setSaveError(tAction("saveError"));
					} finally {
						saving.current = false;
					}
				});
			}}
			className="admin-card"
			style={{
				display: "grid",
				gridTemplateColumns: "minmax(0, 1fr)",
				gap: "1rem",
			}}
		>
			<fieldset disabled={pending} className="contents">
				<input type="hidden" name="baseToken" value={token} />
				{localRecovery.panel}
				{recovery.panel}
				{saveError && (
					<p role="alert" className="text-sm">
						{saveError}
					</p>
				)}
				<div className="grid gap-4 md:grid-cols-2">
					<label className="block">
						<span className="text-xs font-medium text-[var(--admin-text-muted)]">
							{t("title")}
						</span>
						<input
							name="title"
							aria-invalid={!!fieldErrors.title?.length}
							aria-describedby={
								fieldErrors.title?.length ? "error-title" : undefined
							}
							maxLength={255}
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder={t("titlePlaceholder")}
							required
							className="input input-bordered mt-1 w-full"
						/>
						<FormFieldError name="title" errors={fieldErrors} />
					</label>

					<label className="block">
						<span className="text-xs font-medium text-[var(--admin-text-muted)]">
							{t("slug")}
						</span>
						<input
							name="slug"
							maxLength={255}
							value={slugTouched ? slug : suggestedSlug}
							onChange={(e) => {
								setSlug(e.target.value);
								setSlugTouched(true);
							}}
							placeholder={t("slugPlaceholder")}
							className="input input-bordered mt-1 w-full"
						/>
					</label>
				</div>

				<div className="block">
					<span className="text-xs font-medium text-[var(--admin-text-muted)]">
						{t("image")}
					</span>
					<div className="mt-1 flex gap-2 items-start">
						<input
							aria-label={t("image")}
							name="image"
							aria-invalid={!!fieldErrors.image?.length}
							aria-describedby={
								fieldErrors.image?.length ? "error-image" : undefined
							}
							maxLength={255}
							value={image}
							onChange={(e) => {
								setImage(e.target.value);
								setImageError(false);
							}}
							placeholder={t("imagePlaceholder")}
							className="input input-bordered min-w-0 flex-1"
						/>
						<FormFieldError name="image" errors={fieldErrors} />
						<MediaPicker
							onSelect={(url) => {
								setImage(url);
								markDirty();
								setImageError(false);
							}}
							current={image}
						/>
					</div>
					{image && !imageError ? (
						<img
							src={image}
							alt={t("imagePreview")}
							onError={() => setImageError(true)}
							className="mt-2 rounded-lg border border-[var(--admin-text-muted)]/14 object-cover"
							style={{ maxHeight: 160 }}
						/>
					) : null}
					{imageError ? (
						<p className="muted mt-1" style={{ fontSize: "0.78rem" }}>
							{t("imageNotFound")}
						</p>
					) : null}
				</div>

				<label className="block">
					<span className="text-xs font-medium text-[var(--admin-text-muted)]">
						{t("summary")}
					</span>
					<textarea
						name="shortStory"
						aria-invalid={!!fieldErrors.shortStory?.length}
						aria-describedby={
							fieldErrors.shortStory?.length ? "error-shortStory" : undefined
						}
						maxLength={255}
						value={summary}
						onChange={(event) => setSummary(event.target.value)}
						placeholder={t("bodyPlaceholder")}
						rows={2}
						className="input input-bordered mt-1 w-full resize-y"
					/>
					<FormFieldError name="shortStory" errors={fieldErrors} />
				</label>

				<div className="block">
					<span className="text-xs font-medium text-[var(--admin-text-muted)]">
						{t("body")}
					</span>
					<RichText
						ariaLabel={t("body")}
						key={bodyVersion}
						onChange={() => {
							markDirty();
							if (formRef.current)
								setBody(
									String(new FormData(formRef.current).get("fullStory") ?? ""),
								);
						}}
						name="fullStory"
						defaultValue={body}
						placeholder={t("bodyPlaceholder")}
						rows={12}
					/>
				</div>

				<div className="grid gap-4 md:grid-cols-2">
					<label className="block">
						<span className="text-xs font-medium text-[var(--admin-text-muted)]">
							{t("status")}
						</span>
						<select
							name="status"
							aria-invalid={!!fieldErrors.status?.length}
							aria-describedby={
								fieldErrors.status?.length ? "error-status" : undefined
							}
							value={status}
							onChange={(e) => setStatus(e.target.value)}
							className="input input-bordered mt-1 w-full"
						>
							<option value="draft">{t("statusDraft")}</option>
							<option value="scheduled">{t("statusScheduled")}</option>
							<option value="published">{t("statusPublished")}</option>
						</select>
						<FormFieldError name="status" errors={fieldErrors} />
					</label>

					{status === "scheduled" ? (
						<label className="block">
							<span className="text-xs font-medium text-[var(--admin-text-muted)]">
								{t("publishAt")}
							</span>
							<input
								type="datetime-local"
								name="publishAt"
								aria-invalid={!!fieldErrors.publishAt?.length}
								aria-describedby={
									fieldErrors.publishAt?.length ? "error-publishAt" : undefined
								}
								value={publishAt}
								onChange={(e) => setPublishAt(e.target.value)}
								required
								className="input input-bordered mt-1 w-full"
							/>
							<FormFieldError name="publishAt" errors={fieldErrors} />
						</label>
					) : null}
				</div>

				<PublicationPreflight
					issues={issues}
					paths={["/news", `/news/${effectiveSlug}`, "/"]}
				/>
				<div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-[var(--admin-border)] bg-[var(--admin-surface)] py-3">
					<button
						type="button"
						className="btn btn-outline"
						onClick={() => {
							if (!formRef.current) return;
							const values = new FormData(formRef.current);
							setPreview({
								title: String(values.get("title") ?? ""),
								image: String(values.get("image") ?? ""),
								summary: String(values.get("shortStory") ?? ""),
								body: String(values.get("fullStory") ?? ""),
							});
						}}
					>
						{tAction("preview")}
					</button>
					<button
						type="submit"
						className="btn btn-primary"
						disabled={
							pending ||
							(status !== "draft" &&
								issues.some((issue) => issue.severity === "error"))
						}
						aria-busy={pending}
					>
						{pending ? tAction("saving") : t("save")}
					</button>
					{dirty && (
						<span
							role="status"
							className="self-center text-xs text-[var(--admin-text-muted)]"
						>
							{tAction("unsaved")}
						</span>
					)}
				</div>
				<ArticlePreview data={preview} onClose={() => setPreview(null)} />
			</fieldset>
		</form>
	);
}
