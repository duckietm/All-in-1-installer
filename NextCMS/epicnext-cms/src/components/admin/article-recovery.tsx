"use client";
import { useTranslations } from "next-intl";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
	autosaveArticle,
	clearArticleRecovery,
	loadArticleRecovery,
} from "@/actions/article-recovery";
import type { ArticleDraft } from "@/lib/article-draft";

export function useArticleRecovery(
	key: string,
	form: RefObject<HTMLFormElement | null>,
	saving: RefObject<boolean>,
	dirty: boolean,
	restore: (draft: ArticleDraft, revision: boolean) => void,
) {
	const t = useTranslations("pages.admin.articles.form");
	const [recovery, setRecovery] = useState<Awaited<
		ReturnType<typeof loadArticleRecovery>
	> | null>(null);
	const [message, setMessage] = useState("autosaveLoading");
	const [reload, setReload] = useState(0);
	const version = useRef(0);
	const request = useRef<Promise<void> | null>(null);
	const last = useRef("");
	const dirtyRef = useRef(dirty);
	dirtyRef.current = dirty;
	const blocked = useRef(true);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reload restarts the autosave timer for the recovery retry without remounting; read via setReload
	useEffect(() => {
		let active = true;
		blocked.current = true;
		last.current = "";
		setMessage("autosaveLoading");
		loadArticleRecovery(key)
			.then((data) => {
				if (!active) return;
				version.current = data.version;
				setRecovery(data);
				blocked.current = Boolean(data.draft);
				setMessage(data.draft ? "recoveryFound" : "autosaveReady");
			})
			.catch(() => {
				if (active) setMessage("autosaveFailed");
			});
		const timer = setInterval(() => {
			if (
				blocked.current ||
				!dirtyRef.current ||
				saving.current ||
				request.current ||
				!form.current
			)
				return;
			const data = new FormData(form.current);
			const snapshot = JSON.stringify(Array.from(data.entries()));
			if (snapshot === last.current) return;
			setMessage("autosaveSaving");
			request.current = autosaveArticle(key, version.current, data)
				.then((result) => {
					if (!active) return;
					if (!result.ok) {
						blocked.current = true;
						setMessage("autosaveConflict");
						return;
					}
					version.current = result.version;
					last.current = snapshot;
					setMessage("autosaveSaved");
				})
				.catch(() => {
					if (active) setMessage("autosaveFailed");
				})
				.finally(() => {
					request.current = null;
				});
		}, 2500);
		return () => {
			active = false;
			clearInterval(timer);
		};
		// reload restarts the autosave timer without remounting the editor or
		// touching the current form contents; it is what the "Retry recovery"
		// button bumps after reconciling server versions. Removing it from the
		// deps makes that button a no-op.
	}, [key, form, saving, reload]);
	return {
		draft: recovery?.draft?.payload,
		wait: () => request.current ?? Promise.resolve(),
		clear: () => clearArticleRecovery(key, version.current),
		panel: (
			<div className="grid gap-2 text-xs" aria-live="polite">
				<p>{t(message)}</p>
				{(message === "autosaveFailed" || message === "autosaveConflict") && (
					<button
						type="button"
						className="btn btn-outline"
						onClick={async () => {
							if (saving.current) return;
							// Reconcile server versions without replacing any current form contents.
							blocked.current = true;
							await request.current;
							setReload((current) => current + 1);
						}}
					>
						{t("retryRecovery")}
					</button>
				)}
				{recovery?.draft && (
					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							className="btn btn-outline"
							onClick={() => {
								if (!recovery.draft || !window.confirm(t("confirmRecovery")))
									return;
								restore(recovery.draft.payload, false);
								setRecovery({ ...recovery, draft: null });
								blocked.current = false;
								setMessage("autosaveReady");
							}}
						>
							{t("recoverDraft")}
						</button>
						<button
							type="button"
							className="btn btn-outline"
							onClick={async () => {
								if (!window.confirm(t("confirmDiscardDraft"))) return;
								try {
									await clearArticleRecovery(key, version.current);
									// Reload the version in case another tab changed it before discarding.
									const data = await loadArticleRecovery(key);
									version.current = data.version;
									setRecovery(data);
									blocked.current = Boolean(data.draft);
									setMessage(data.draft ? "autosaveConflict" : "autosaveReady");
								} catch {
									setMessage("autosaveFailed");
								}
							}}
						>
							{t("discardDraft")}
						</button>
					</div>
				)}
				{!!recovery?.revisions.length && (
					<details>
						<summary>{t("revisionHistory")}</summary>
						<ul className="grid gap-2 mt-2">
							{recovery.revisions.map((revision) => (
								<li key={revision.id} className="flex gap-2 items-center">
									<time dateTime={revision.createdAt}>
										{new Date(revision.createdAt).toLocaleString()}
									</time>
									<span>{revision.payload.title}</span>
									<button
										type="button"
										className="btn btn-outline"
										onClick={() => {
											if (
												blocked.current ||
												!window.confirm(t("confirmRevision"))
											)
												return;
											restore(revision.payload, true);
										}}
										disabled={Boolean(recovery.draft)}
									>
										{t("restoreRevision")}
									</button>
								</li>
							))}
						</ul>
					</details>
				)}
			</div>
		),
	};
}
