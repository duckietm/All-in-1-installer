"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
	decodeRecovery,
	encodeRecovery,
	type RecoveryKind,
	recoveryKey,
} from "@/lib/form-recovery";

/** Local fallback complements server autosave and survives an expired session. */
export function useFormRecovery({
	userId,
	kind,
	record,
	dirty,
	snapshot,
	restore,
	serverDraft,
}: {
	userId?: string;
	kind: RecoveryKind;
	record: string;
	dirty: boolean;
	serverDraft?: unknown;
	snapshot: () => unknown;
	restore: (payload: Record<string, unknown>) => void;
}) {
	const t = useTranslations("draftRecovery");
	const key = userId ? recoveryKey(userId, kind, record) : null;
	const current = useRef({ dirty, snapshot, restore, key });
	current.current = { dirty, snapshot, restore, key };
	const [found, setFound] = useState<ReturnType<typeof decodeRecovery> | null>(
		null,
	);
	const [state, setState] = useState<"ready" | "saved" | "unavailable">(
		"ready",
	);
	const blocked = useRef(true);
	const last = useRef<string | null>(null);
	const suppressed = useRef(false);
	const lastPayload = useRef("");
	const savedSnapshot = useRef("");
	const flush = useRef(() => {});
	useEffect(() => {
		blocked.current = true;
		suppressed.current = false;
		lastPayload.current = "";
		setFound(null);
		setState("ready");
		if (!key) return;
		try {
			const raw = localStorage.getItem(key);
			last.current = raw;
			if (raw) {
				try {
					setFound(decodeRecovery(kind, raw));
				} catch {
					localStorage.removeItem(key);
					last.current = null;
					blocked.current = false;
				}
			} else blocked.current = false;
		} catch {
			setState("unavailable");
			blocked.current = false;
		}
		function persist() {
			if (
				current.current.key !== key ||
				blocked.current ||
				!current.current.dirty
			)
				return;
			if (
				suppressed.current &&
				JSON.stringify(current.current.snapshot()) === savedSnapshot.current
			)
				return;
			suppressed.current = false;
			try {
				// Do not overwrite a draft written by another tab without offering recovery.
				const existing = localStorage.getItem(key as string);
				if (existing !== last.current && existing) {
					setFound(decodeRecovery(kind, existing));
					last.current = existing;
					blocked.current = true;
					return;
				}
				const payload = encodeRecovery(kind, current.current.snapshot(), 0);
				if (payload === lastPayload.current && existing === last.current)
					return;
				const raw = encodeRecovery(kind, current.current.snapshot());
				localStorage.setItem(key as string, raw);
				lastPayload.current = payload;
				last.current = raw;
				setState("saved");
			} catch {
				setState("unavailable");
			}
		}
		flush.current = persist;
		const timer = window.setInterval(persist, 750);
		const visibility = () => {
			if (document.visibilityState === "hidden") persist();
		};
		window.addEventListener("pagehide", persist);
		window.addEventListener("beforeunload", persist);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			persist();
			clearInterval(timer);
			window.removeEventListener("pagehide", persist);
			window.removeEventListener("beforeunload", persist);
			document.removeEventListener("visibilitychange", visibility);
			flush.current = () => {};
		};
	}, [key, kind]);
	function clear() {
		blocked.current = false;
		lastPayload.current = "";
		suppressed.current = true;
		savedSnapshot.current = JSON.stringify(current.current.snapshot());
		setFound(null);
		if (!key) return;
		try {
			if (localStorage.getItem(key) === last.current)
				localStorage.removeItem(key);
			last.current = null;
			setState("ready");
		} catch {
			setState("unavailable");
		}
	}
	useEffect(() => {
		if (!found || !serverDraft) return;
		try {
			if (
				encodeRecovery(kind, found.payload, 0) ===
				encodeRecovery(kind, serverDraft, 0)
			) {
				setFound(null);
				blocked.current = false;
			}
		} catch {
			/* The server keeps its own validation and recovery flow. */
		}
	}, [found, serverDraft, kind]);
	// A new edit after successful save enables the next recovery snapshot.
	function changed() {
		suppressed.current = false;
	}
	return {
		clear,
		changed,
		flush: () => flush.current(),
		panel: !key ? null : (
			<div className="grid gap-2 text-xs" aria-live="polite">
				<p>
					{t(found ? "found" : state)}
					{found && (
						<>
							{" "}
							<time dateTime={new Date(found.savedAt).toISOString()}>
								{new Date(found.savedAt).toLocaleString()}
							</time>
						</>
					)}
				</p>
				{found && (
					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							className="btn btn-outline"
							onClick={() => {
								if (!window.confirm(t("confirmRestore"))) return;
								current.current.restore(found.payload);
								blocked.current = false;
								suppressed.current = false;
								setFound(null);
							}}
						>
							{t("restore")}
						</button>
						<button
							type="button"
							className="btn btn-outline"
							onClick={() => {
								if (!window.confirm(t("confirmDiscard"))) return;
								clear();
								blocked.current = false;
								suppressed.current = false;
							}}
						>
							{t("discard")}
						</button>
					</div>
				)}
			</div>
		),
	};
}
